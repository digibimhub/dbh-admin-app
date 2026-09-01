import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import {
  apsConfigured, authorizeUrl, encryptAtRest, exchangeCode,
  fetchUserInfo, getApsConfig, pkceChallenge, pkceVerifier, randomToken,
  resolveUser, sha256Hex, type AutodeskIdentity,
} from '@app/core';
import { authExchangeSchema, authStartSchema, deviceInfoSchema, type DeviceInfo } from '@app/shared';
import { ensureEncryptionKey } from '../../env';
import { HttpError } from '../../lib/errors';
import { denial } from '../../lib/deny';
import { dbResolveDeps, backfillIdentity } from '../../lib/resolve-deps';
import {
  recordGrant, signAccessToken, SESSION_IDLE_MS, SESSION_MAX_MS,
} from '../../lib/addin-grant';
import { clientIpOrNull } from '../../middleware/ratelimit';

export const addinAuth = new Hono();

/**
 * The handoff is redeemable for tokens, so it gets the same five-minute life
 * as the OAuth state and is stored hashed, never in the clear.
 */
const HANDOFF_TTL_MS = 5 * 60 * 1000;

interface StatePayload {
  device: DeviceInfo;
  handoffHash?: string | null;
  identity?: AutodeskIdentity;
  denied?: string;
  /** APS tokens, AES-GCM encrypted before they touch the row. */
  aps?: { accessTokenEnc: string; refreshTokenEnc: string | null; expiresIn: number } | null;
}

function readState(value: unknown): StatePayload {
  const raw = (value ?? {}) as Partial<StatePayload>;
  const device = deviceInfoSchema.safeParse(raw.device);
  return {
    ...raw,
    device: device.success ? device.data : { deviceHash: 'unknown-device-hash-missing' },
  };
}

/** Compares two hex digests without leaking their divergence point. */
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

addinAuth.post('/start', async (c) => {
  if (!apsConfigured()) {
    throw new HttpError(
      503,
      'aps_not_configured',
      'Autodesk APS credentials are not set. Add APS_CLIENT_ID and APS_CLIENT_SECRET to .env.',
    );
  }
  const body = authStartSchema.parse(await c.req.json());
  const cfg = getApsConfig();
  const state = randomToken(24);
  const verifier = pkceVerifier();

  const payload: StatePayload = { device: body.device };
  await db.insert(s.oauthStates).values({
    state,
    // PKCE verifier. Held server-side so the callback can complete the
    // exchange; useless to anyone without the matching authorization code.
    codeChallenge: verifier,
    deviceHash: body.device.deviceHash,
    deviceInfo: payload,
    redirectPort: body.redirectPort,
    expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
  });

  return c.json({
    // S256 is BASE64URL(SHA256(verifier)), not a hex digest — Autodesk
    // recomputes this exact encoding and rejects anything else.
    authorize_url: authorizeUrl(cfg, state, pkceChallenge(verifier)),
    state,
    expires_in: 300,
  });
});

addinAuth.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) throw new HttpError(400, 'bad_request', 'Missing code or state');

  const [row] = await db.select().from(s.oauthStates).where(eq(s.oauthStates.state, state)).limit(1);
  if (!row || row.consumedAt || row.expiresAt < new Date()) {
    throw new HttpError(400, 'invalid_state', 'OAuth state is invalid or expired');
  }

  ensureEncryptionKey();
  const cfg = getApsConfig();
  const tokens = await exchangeCode(cfg, code, row.codeChallenge);
  const info = await fetchUserInfo(tokens.accessToken);
  const stored = readState(row.deviceInfo);
  const device: DeviceInfo = {
    ...stored.device,
    deviceHash: row.deviceHash ?? stored.device.deviceHash,
  };

  const identity: AutodeskIdentity = {
    autodeskId: info.sub,
    email: info.email,
    emailVerified: info.emailVerified,
    displayName: info.name,
    givenName: info.givenName,
    familyName: info.familyName,
  };

  const result = await resolveUser(identity, device, dbResolveDeps());

  const handoff = randomToken(24);
  const payload: StatePayload = {
    device,
    handoffHash: sha256Hex(handoff),
    identity,
    denied: result.ok ? undefined : result.code,
    // Encrypted at rest: oauth_states is a short-lived scratch table, but an
    // APS bearer token in plaintext jsonb is a live credential in every
    // backup taken while it sat there.
    aps: {
      accessTokenEnc: encryptAtRest(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encryptAtRest(tokens.refreshToken) : null,
      expiresIn: tokens.expiresIn,
    },
  };

  await db.update(s.oauthStates)
    .set({ consumedAt: new Date(), deviceInfo: payload })
    .where(eq(s.oauthStates.state, state));

  const port = row.redirectPort ?? 51234;
  const status = result.ok ? 'ok' : 'denied';
  return c.redirect(`http://127.0.0.1:${port}/callback?result=${status}&handoff=${handoff}`);
});

addinAuth.post('/exchange', async (c) => {
  const { handoff } = authExchangeSchema.parse(await c.req.json());
  const handoffHash = sha256Hex(handoff);
  const ip = clientIpOrNull(c);
  ensureEncryptionKey();

  return db.transaction(async (tx) => {
    // Indexed predicate on the stored hash, with FOR UPDATE so two racing
    // add-in instances cannot both redeem the same handoff. The previous
    // version read every oauth_states row into memory and compared in JS.
    const [match] = await tx.select().from(s.oauthStates)
      .where(and(
        isNotNull(s.oauthStates.consumedAt),
        sql`${s.oauthStates.deviceInfo} ->> 'handoffHash' = ${handoffHash}`,
        sql`${s.oauthStates.consumedAt} > now() - interval '5 minutes'`,
      ))
      .limit(1)
      .for('update');

    if (!match) throw new HttpError(400, 'invalid_handoff', 'Unknown or expired handoff');

    const payload = readState(match.deviceInfo);
    if (!payload.handoffHash || !sameDigest(payload.handoffHash, handoffHash)) {
      throw new HttpError(400, 'invalid_handoff', 'Unknown or expired handoff');
    }

    // Single use. Burn it first so a replay cannot mint a second session.
    await tx.update(s.oauthStates)
      .set({ deviceInfo: { ...payload, handoffHash: null, aps: null } })
      .where(eq(s.oauthStates.state, match.state));

    const identity = payload.identity;
    if (!identity) throw new HttpError(400, 'invalid_handoff', 'Handoff is missing its identity');

    // Re-resolve rather than trusting the result cached at callback time: an
    // operator may have approved or disabled the account in between.
    const result = await resolveUser(identity, payload.device, dbResolveDeps(tx));
    if (!result.ok) return c.json(denial(result.code));

    await backfillIdentity(tx, result.userId, identity);
    const { deviceId } = await recordGrant(tx, {
      result,
      device: payload.device,
      ip,
      isLaunch: true,
    });

    const refresh = randomToken(32);
    const [session] = await tx.insert(s.addinSessions).values({
      orgId: result.orgId,
      orgUserId: result.userId,
      deviceId,
      refreshTokenHash: sha256Hex(refresh),
      apsAccessTokenEnc: payload.aps?.accessTokenEnc ?? null,
      apsRefreshTokenEnc: payload.aps?.refreshTokenEnc ?? null,
      apsExpiresAt: payload.aps ? new Date(Date.now() + payload.aps.expiresIn * 1000) : null,
      apsScopes: process.env.APS_SCOPES ?? null,
      expiresAt: new Date(Date.now() + SESSION_IDLE_MS),
      maxLifetimeAt: new Date(Date.now() + SESSION_MAX_MS),
    }).returning();

    // The email claim drives the add-in's error text. An empty one turns
    // "Jo Smith's licence ended" into an anonymous failure, which is the
    // difference between a user fixing it and a support ticket.
    const token = await signAccessToken(result, identity.email);

    return c.json({
      status: 'ok',
      access_token: token.accessToken,
      refresh_token: refresh,
      expires_in: token.expiresIn,
      next_check: token.nextCheck,
      session_id: session!.id,
      scopes: result.scopes,
      role: result.roleKey,
    });
  });
});
