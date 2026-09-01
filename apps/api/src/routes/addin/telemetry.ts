import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { addinTokenKid, verifyAddinJwt } from '@app/core';
import type { AddinTokenClaims } from '@app/shared';
import { env } from '../../env';
import { denial } from '../../lib/deny';
import { telemetrySchema } from '../../lib/validation';
import { publicKeyForKid } from '../../lib/signing';
import { today } from '../../lib/addin-grant';

export const addinTelemetry = new Hono();

/**
 * Select the key by the token's own `kid`. During a rotation both keys are
 * live, and a workstation holding a token signed minutes before the switch
 * must not be told its session is invalid.
 */
async function verifyAccessToken(token: string): Promise<AddinTokenClaims | null> {
  try {
    const pem = await publicKeyForKid(addinTokenKid(token));
    if (!pem) return null;
    return await verifyAddinJwt(token, pem, env.apiPublicUrl);
  } catch {
    // Unparseable header, unknown kid, bad signature, wrong issuer, expired.
    return null;
  }
}

function bearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const value = header.slice(7).trim();
  return value.length ? value : null;
}

/**
 * POST /v1/telemetry — batched command usage from the add-in.
 *
 * Analytics only. It can never grant or widen access, so it authenticates
 * with the access token the add-in already holds and never re-runs
 * resolveUser. An unusable token is reported as a policy denial (HTTP 200)
 * so the client keeps its single denial code path.
 */
addinTelemetry.post('/', async (c) => {
  const token = bearer(c.req.header('authorization'));
  if (!token) return c.json(denial('invalid_token'));

  const claims = await verifyAccessToken(token);
  if (!claims) return c.json(denial('invalid_token'));

  const body = telemetrySchema.parse(await c.req.json());
  const usageDate = body.usageDate ?? today();

  return db.transaction(async (tx) => {
    // The token proves who the caller is; the device must still belong to the
    // same org, or a leaked token could write usage against someone else's
    // workstation.
    const [device] = await tx.select().from(s.devices)
      .where(and(
        eq(s.devices.orgId, claims.org),
        eq(s.devices.deviceHash, body.device.deviceHash),
      ))
      .limit(1);

    if (!device) return c.json(denial('invalid_token'));
    if (device.status === 'disabled') return c.json(denial('device_disabled'));

    if (body.activeMinutes > 0) {
      await tx.insert(s.usageDaily).values({
        orgId: claims.org,
        orgUserId: claims.sub,
        deviceId: device.id,
        usageDate,
        launches: 0,
        heartbeats: 0,
        activeMinutes: body.activeMinutes,
        revitVersion: body.device.revitVersion,
        addinVersion: body.device.addinVersion,
      }).onConflictDoUpdate({
        target: [s.usageDaily.orgId, s.usageDaily.orgUserId, s.usageDaily.deviceId, s.usageDaily.usageDate],
        set: {
          activeMinutes: sql`${s.usageDaily.activeMinutes} + ${body.activeMinutes}`,
          lastSeenAt: new Date(),
        },
      });
    }

    // Per-command counts are accepted and discarded for now: the table they
    // landed in had one reader, a device-detail panel that is not part of this
    // phase. The add-in keeps sending them, so nothing in the field breaks, and
    // the store comes back with the screen that needs it.

    await tx.update(s.orgUsers)
      .set({ lastActivityAt: new Date() })
      .where(eq(s.orgUsers.id, claims.sub));

    return c.json({
      status: 'ok',
      accepted_commands: body.commands.length,
      accepted_minutes: body.activeMinutes,
    });
  });
});
