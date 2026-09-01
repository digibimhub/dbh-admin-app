import { Hono } from 'hono';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import {
  offlineGraceExceeded, randomToken, resolveUser, sha256Hex,
  type AutodeskIdentity,
} from '@app/core';
import { tokenRefreshSchema } from '@app/shared';
import { denial, type DenialBody } from '../../lib/deny';
import { dbResolveDeps, backfillIdentity } from '../../lib/resolve-deps';
import {
  recordGrant, signAccessToken, REFRESH_REPLAY_MS, SESSION_IDLE_MS,
} from '../../lib/addin-grant';
import { clientIpOrNull } from '../../middleware/ratelimit';

export const addinValidate = new Hono();

interface GrantBody {
  status: 'ok';
  access_token: string;
  refresh_token: string;
  expires_in: number;
  next_check: string;
  scopes: string[];
  role: string;
}

/**
 * POST /v1/token/refresh — daily validation and heartbeat in one call.
 *
 * Everything below happens inside a single transaction, so a crash between
 * rotating the refresh token and recording the heartbeat cannot leave a
 * workstation holding a token the server has already invalidated:
 *
 *   1. verify the refresh token and rotate it
 *   2. re-run resolveUser  (role changes, disabled users, expired licences)
 *   3. upsert the device   (last_seen, revit_versions, addin_version)
 *   4. upsert usage_daily  (heartbeats, launches)
 *   5. sign a fresh access token
 *
 * Denials come back as HTTP 200 with a structured body, never 4xx — the
 * add-in handles every "you cannot work today" case through one code path.
 */
addinValidate.post('/refresh', async (c) => {
  const body = tokenRefreshSchema.parse(await c.req.json());
  const presentedHash = sha256Hex(body.refreshToken);
  const ip = clientIpOrNull(c);

  const result = await db.transaction(async (tx): Promise<GrantBody | DenialBody> => {
    // --- 1. verify -------------------------------------------------------
    // Matched against the current hash OR the previous one, because a rotation
    // whose reply never arrived leaves the workstation holding the previous
    // token through no fault of its own. FOR UPDATE serialises two Revit
    // instances on the same machine refreshing at once; without it both could
    // rotate and one would be left holding a dead token.
    const [session] = await tx.select().from(s.addinSessions)
      .where(and(
        or(
          eq(s.addinSessions.refreshTokenHash, presentedHash),
          eq(s.addinSessions.previousTokenHash, presentedHash),
        ),
        isNull(s.addinSessions.revokedAt),
      ))
      .limit(1)
      .for('update');

    if (!session) return denial('invalid_token');

    const now = new Date();
    // Two clocks: the idle window slides on every refresh, the absolute
    // horizon never moves. An active user only ever meets the second one.
    if (session.expiresAt < now || session.maxLifetimeAt < now) {
      return denial('invalid_token');
    }

    /**
     * The replay window.
     *
     * Presenting a rotated-away token is either a retry whose reply was lost
     * — a dropped VPN, a laptop that slept mid-request — or a stolen token
     * being used behind the real client's back. Age is what separates them.
     *
     * Inside the window we rotate normally and say nothing: the client gets a
     * working pair and keeps working. Outside it, a token still in use after
     * the legitimate holder has moved on is theft, and the whole session goes.
     *
     * Without this window, every lost response is a forced sign-in mid-model,
     * which is a worse and far more frequent failure than the one strict
     * rotation is guarding against.
     */
    if (session.refreshTokenHash !== presentedHash) {
      const rotatedAt = session.previousRotatedAt?.getTime() ?? 0;
      if (now.getTime() - rotatedAt > REFRESH_REPLAY_MS) {
        await tx.update(s.addinSessions)
          .set({ revokedAt: now, revokedReason: 'refresh token reuse detected' })
          .where(eq(s.addinSessions.id, session.id));
        return denial('invalid_token');
      }
    }

    const [user] = await tx.select().from(s.orgUsers)
      .where(eq(s.orgUsers.id, session.orgUserId)).limit(1);
    if (!user) return denial('invalid_token');

    // --- 2. re-resolve ---------------------------------------------------
    const identity: AutodeskIdentity = {
      // A row with no autodesk_id can only have come from an operator import.
      // The sentinel cannot collide with a real Autodesk subject, so the
      // lookup falls through to the email match, which is what we want.
      autodeskId: user.autodeskId ?? `pending-import:${user.id}`,
      email: user.email ?? '',
      emailVerified: user.emailVerified,
      displayName: user.displayName ?? undefined,
      givenName: user.givenName ?? undefined,
      familyName: user.familyName ?? undefined,
    };

    const resolved = await resolveUser(identity, body.device, dbResolveDeps(tx));

    if (!resolved.ok) {
      // Deliberately do NOT rotate or revoke here. A licence that expired this
      // morning is renewed this afternoon, and a seat freed at 11am should let
      // the next check through at noon — if a denial burned the refresh token
      // the workstation could never come back without a full re-authentication.
      // `seats_exhausted` depends on exactly this.
      return denial(resolved.code);
    }

    if (offlineGraceExceeded(body.daysSinceLastSuccess, resolved.license.graceDays)) {
      return denial('offline_grace_exceeded');
    }

    // --- 1b. rotate ------------------------------------------------------
    // The idle window slides, but never past the absolute horizon.
    const slid = new Date(now.getTime() + SESSION_IDLE_MS);
    const nextExpiry = slid < session.maxLifetimeAt ? slid : session.maxLifetimeAt;

    const nextRefresh = randomToken(32);
    await tx.update(s.addinSessions)
      .set({
        refreshTokenHash: sha256Hex(nextRefresh),
        // Whatever they presented becomes the previous token, so a lost reply
        // to THIS response is covered by the same window on the next attempt.
        previousTokenHash: presentedHash,
        previousRotatedAt: now,
        lastRefreshedAt: now,
        expiresAt: nextExpiry,
        orgId: resolved.orgId,
        orgUserId: resolved.userId,
      })
      .where(eq(s.addinSessions.id, session.id));

    await backfillIdentity(tx, resolved.userId, identity);

    // --- 3 + 4. device and usage ----------------------------------------
    // A refresh after a gap of more than a day is a fresh Revit launch;
    // several refreshes inside one day are heartbeats on the same session.
    const isLaunch = !session.lastRefreshedAt
      || now.getTime() - session.lastRefreshedAt.getTime() > 20 * 60 * 60 * 1000;

    const { deviceId } = await recordGrant(tx, {
      result: resolved,
      device: body.device,
      ip,
      isLaunch,
    });

    if (session.deviceId !== deviceId) {
      await tx.update(s.addinSessions)
        .set({ deviceId })
        .where(eq(s.addinSessions.id, session.id));
    }

    // --- 5. sign ---------------------------------------------------------
    const token = await signAccessToken(resolved, user.email ?? identity.email);

    return {
      status: 'ok',
      access_token: token.accessToken,
      refresh_token: nextRefresh,
      expires_in: token.expiresIn,
      next_check: token.nextCheck,
      // Re-resolved every refresh, so a role or scope change reaches the
      // workstation at its next check with no re-authentication.
      scopes: resolved.scopes,
      role: resolved.roleKey,
    };
  });

  return c.json(result);
});
