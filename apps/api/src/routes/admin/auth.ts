import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import {
  currentTotp, DEV_TOTP_SECRET, dummyPasswordVerify, generateTotpSecret,
  signPortalJwt, totpUri, verifyPassword, verifyTotp, verifyTotpWithReplay,
} from '@app/core';
import { portalLoginSchema, totpConfirmSchema } from '@app/shared';
import { env, limits } from '../../env';
import { invalidCredentials, unauthorized, badRequest } from '../../lib/errors';
import { audit } from '../../middleware/audit';
import { clientIp, consumeRateLimit } from '../../middleware/ratelimit';
import { verifyTurnstile } from '../../lib/turnstile';
import {
  openPendingSecret, openTotpSecret, sealPendingSecret, sealTotpSecret,
} from '../../lib/totp-secret';

export const adminAuth = new Hono();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'Lax' as const,
  path: '/',
  secure: !env.isDev,
  maxAge: 8 * 3600,
};

/**
 * Brute-force budget from the spec: 5 per email / 15 min, 20 per IP.
 *
 * The counts come from `limits` in env.ts, which raises them on a developer
 * machine. The windows do not change: a shorter one in dev would make the
 * behaviour differ in kind rather than in degree.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_EMAIL = limits.loginPerEmail;
const LOGIN_MAX_PER_IP = limits.loginPerIp;
const LOCKOUT_AFTER = limits.lockoutAfter;
const LOCKOUT_MS = 15 * 60 * 1000;

type PortalUserRow = typeof s.portalUsers.$inferSelect;

function publicUser(u: PortalUserRow) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    totpEnabled: u.totpEnabled,
    totpResetRequired: u.totpResetRequired,
  };
}

adminAuth.get('/dev-hint', async (c) => {
  if (!env.isDev || !env.devAuthHint) return c.json({ enabled: false });
  return c.json({
    enabled: true,
    email: 'admin@yourco.local',
    password: 'localdev-password',
    totp: currentTotp(DEV_TOTP_SECRET),
  });
});

adminAuth.post('/login', async (c) => {
  const body = portalLoginSchema.parse(await c.req.json());
  const ip = clientIp(c);

  // Counted before any database work so a flood cannot be used to probe
  // response timing, and keyed on the normalised email so case variants
  // share one budget.
  const emailKey = body.email.trim().toLowerCase();
  consumeRateLimit('login-ip', ip, LOGIN_WINDOW_MS, LOGIN_MAX_PER_IP);
  consumeRateLimit('login-email', emailKey, LOGIN_WINDOW_MS, LOGIN_MAX_PER_EMAIL);

  if (!await verifyTurnstile(body.turnstile, ip)) {
    await dummyPasswordVerify();
    throw invalidCredentials();
  }

  const rows = await db.select().from(s.portalUsers).where(eq(s.portalUsers.email, emailKey)).limit(1);
  const user = rows[0];

  if (!user?.isActive || !user.passwordHash) {
    // Always spend the same work as a real verify, or response timing
    // reveals which addresses have accounts.
    await dummyPasswordVerify();
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await dummyPasswordVerify();
    throw invalidCredentials();
  }

  const passwordOk = await verifyPassword(user.passwordHash, body.password);
  if (!passwordOk) {
    await registerFailure(user);
    throw invalidCredentials();
  }

  const needsEnrol = !user.totpEnabled || user.totpResetRequired;

  if (!needsEnrol) {
    const secret = openTotpSecret(user.totpSecretEnc);
    if (!body.totp || !secret) {
      await registerFailure(user);
      throw invalidCredentials();
    }
    // Replay guard: a code read over someone's shoulder is worthless once
    // its own 30-second counter has been consumed.
    const check = verifyTotpWithReplay(secret, body.totp, user.lastTotpCounter);
    if (!check.ok) {
      await registerFailure(user);
      // Never say whether it was the wrong code or a reused one.
      throw invalidCredentials();
    }
    await db.update(s.portalUsers).set({
      lastTotpCounter: check.counter,
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: ip,
    }).where(eq(s.portalUsers.id, user.id));
  } else {
    await db.update(s.portalUsers).set({
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: ip,
    }).where(eq(s.portalUsers.id, user.id));
  }

  const token = await signPortalJwt({
    sub: user.id,
    role: user.role,
    epoch: user.sessionEpoch,
    typ: needsEnrol ? 'enrol' : 'session',
  }, needsEnrol ? 30 * 60 : 8 * 3600);

  setCookie(c, env.cookieName, token, COOKIE_OPTS);

  await audit(c, {
    actorId: user.id,
    actorEmail: user.email,
    action: needsEnrol ? 'portal.login_enrol_required' : 'portal.login',
    targetType: 'portal_user',
    targetId: user.id,
    after: { needsEnrol },
  });

  return c.json({ user: publicUser(user), needsEnrol, token });
});

/**
 * Counts a failed factor and locks the account after enough of them. The
 * counter existed before but nothing ever set `locked_until`, so the lockout
 * branch in login could never fire.
 */
async function registerFailure(user: PortalUserRow): Promise<void> {
  const attempts = user.failedAttempts + 1;
  await db.update(s.portalUsers).set({
    failedAttempts: attempts,
    lockedUntil: attempts >= LOCKOUT_AFTER ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil,
  }).where(eq(s.portalUsers.id, user.id));
}

adminAuth.post('/logout', async (c) => {
  const user = c.get('portalUser');
  // Bumping the epoch invalidates every outstanding token for this user, not
  // just the cookie we are about to clear.
  await db.update(s.portalUsers)
    .set({ sessionEpoch: sql`${s.portalUsers.sessionEpoch} + 1` })
    .where(eq(s.portalUsers.id, user.id));
  deleteCookie(c, env.cookieName, { path: '/' });
  await audit(c, {
    action: 'portal.logout',
    targetType: 'portal_user',
    targetId: user.id,
  });
  return c.json({ ok: true });
});

adminAuth.get('/me', async (c) => c.json({ user: publicUser(c.get('portalUser')) }));

adminAuth.post('/totp/enrol', async (c) => {
  const user = c.get('portalUser');
  const claims = c.get('portalClaims');
  if (claims.typ !== 'enrol' && user.totpEnabled && !user.totpResetRequired) {
    throw badRequest('TOTP already enrolled');
  }

  const secret = generateTotpSecret();
  // Not persisted until a valid code confirms it, so an abandoned enrolment
  // cannot lock someone out of their own account. It rides in the enrolment
  // cookie meanwhile — sealed, because a JWT payload is base64 and anyone who
  // saw the cookie could otherwise read the secret and enrol themselves.
  const token = await signPortalJwt({
    sub: user.id,
    role: user.role,
    epoch: user.sessionEpoch,
    typ: 'enrol',
    pending_secret: sealPendingSecret(secret),
  }, 30 * 60);

  setCookie(c, env.cookieName, token, { ...COOKIE_OPTS, maxAge: 30 * 60 });
  await audit(c, {
    action: 'portal.totp_enrol_start',
    targetType: 'portal_user',
    targetId: user.id,
  });

  return c.json({ secret, otpauthUrl: totpUri(secret, user.email) });
});

adminAuth.post('/totp/confirm', async (c) => {
  const user = c.get('portalUser');
  const body = totpConfirmSchema.parse(await c.req.json());
  const pending = openPendingSecret(c.get('portalClaims').pending_secret);
  const secret = pending ?? openTotpSecret(user.totpSecretEnc);
  if (!secret) throw badRequest('Start enrolment first');

  const check = verifyTotp(secret, body.totp);
  if (!check.ok) throw badRequest('Invalid authenticator code');

  await db.update(s.portalUsers).set({
    totpSecretEnc: sealTotpSecret(secret),
    totpEnabled: true,
    totpEnrolledAt: new Date(),
    totpResetRequired: false,
    lastTotpCounter: check.counter,
  }).where(eq(s.portalUsers.id, user.id));

  const token = await signPortalJwt({
    sub: user.id,
    role: user.role,
    epoch: user.sessionEpoch,
    typ: 'session',
  });
  setCookie(c, env.cookieName, token, COOKIE_OPTS);

  await audit(c, {
    action: 'portal.totp_enrol',
    targetType: 'portal_user',
    targetId: user.id,
    after: { totpEnabled: true },
  });

  return c.json({ ok: true, token });
});

/**
 * Fresh second factor for destructive operations. There is no sessions
 * table, so the proof rides in the JWT as `last_reauth_at` and
 * `requireStepUp` rejects anything older than five minutes.
 */
adminAuth.post('/step-up', async (c) => {
  const user = c.get('portalUser');
  const body = totpConfirmSchema.parse(await c.req.json());
  const secret = openTotpSecret(user.totpSecretEnc);
  if (!secret) throw unauthorized();

  const check = verifyTotpWithReplay(secret, body.totp, user.lastTotpCounter);
  if (!check.ok) throw invalidCredentials();

  await db.update(s.portalUsers)
    .set({ lastTotpCounter: check.counter })
    .where(eq(s.portalUsers.id, user.id));

  const token = await signPortalJwt({
    sub: user.id,
    role: user.role,
    epoch: user.sessionEpoch,
    typ: 'session',
    last_reauth_at: Math.floor(Date.now() / 1000),
  });
  setCookie(c, env.cookieName, token, COOKIE_OPTS);

  await audit(c, {
    action: 'portal.step_up',
    targetType: 'portal_user',
    targetId: user.id,
  });

  return c.json({ ok: true, token });
});
