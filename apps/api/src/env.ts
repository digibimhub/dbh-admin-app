import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { apsHostsAreAutodesk } from '@app/core';

const here = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(here, '../../../.env') });
config({ path: resolve(here, '../../../.env.local') });

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isDev: (process.env.NODE_ENV ?? 'development') !== 'production',
  databaseUrl: req('DATABASE_URL'),
  apiPort: Number(process.env.API_PORT ?? 3001),
  adminUrl: process.env.ADMIN_URL ?? 'http://localhost:3000',
  apiPublicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`,
  jwtPortalSecret: req('JWT_PORTAL_SECRET', envDevSecret()),
  jwtSigningKid: process.env.JWT_SIGNING_KID ?? 'k2026a',
  jwtSigningKeyPem: process.env.JWT_SIGNING_KEY_PEM ?? '',
  jwtSigningPublicPem: process.env.JWT_SIGNING_PUBLIC_PEM ?? '',
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  turnstileSecret: process.env.TURNSTILE_SECRET ?? '',
  devAuthHint: process.env.DEV_AUTH_HINT === 'true',
  cookieName: 'portal_session',
  /** node-cron scheduler. Off in tests, and off on replicas until pg-boss lands. */
  enableJobs: (process.env.ENABLE_JOBS ?? 'true') !== 'false',
  /** Where expiry-alert digests go. Empty = log only. */
  alertEmailTo: process.env.ALERT_EMAIL_TO ?? '',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  /** Devices with no heartbeat for this many days are marked stale. */
  staleDeviceDays: Number(process.env.STALE_DEVICE_DAYS ?? 45),
  /** usage_daily rows older than this are rolled up and pruned. */
  usageRetentionDays: Number(process.env.USAGE_RETENTION_DAYS ?? 90),
};

function envDevSecret(): string | undefined {
  if ((process.env.NODE_ENV ?? 'development') === 'production') return undefined;
  return 'local-dev-portal-secret-not-for-production-use';
}

/**
 * Brute-force budgets.
 *
 * The production numbers are the ones from the spec. On a developer machine
 * they are raised to the point of not firing, because there the limiter only
 * ever locks you out of your own laptop: a mistyped TOTP costs one of five
 * attempts, `pnpm smoke` spends four, and the portal shows the same generic
 * message for a 429 as for a wrong password — so the usual outcome is fifteen
 * minutes spent believing login is broken.
 *
 * Gated on `isDev`, the same switch that already decides whether
 * `/admin/auth/dev-hint` hands out the password and whether the session
 * cookie demands HTTPS. Anything running with NODE_ENV unset is already
 * giving away credentials on request; the rate limit is not what is holding
 * it together.
 *
 * The account lockout is the sharper edge of the two: it lives in
 * `portal_users.locked_until`, so unlike the in-memory limiter it survives
 * the API restart that AGENTS.md recommends as the way out.
 */
export const limits = {
  loginPerEmail: env.isDev ? 100 : 5,
  loginPerIp: env.isDev ? 200 : 20,
  lockoutAfter: env.isDev ? 50 : 10,
  /** `/admin/*` per IP per minute. The portal spends several on every page. */
  adminPerMinute: env.isDev ? 2000 : 120,
};

export function ensureEncryptionKey(): string {
  if (env.encryptionKey) return env.encryptionKey;
  if (!env.isDev) throw new Error('ENCRYPTION_KEY is required');
  const generated = randomBytes(32).toString('base64');
  process.env.ENCRYPTION_KEY = generated;
  env.encryptionKey = generated;
  console.warn('ENCRYPTION_KEY was empty — generated an ephemeral local key. Set it in .env to persist.');
  return generated;
}

/**
 * Refuse to start in production with the Autodesk endpoints pointed elsewhere.
 *
 * `APS_AUTH_BASE` and `APS_USERINFO_URL` are overridable so the E2E suite can
 * run the real sign-in code against a local OIDC issuer. That override is also
 * the one way this system could be made to trust an identity Autodesk never
 * asserted — so in production it is not a warning, it is a refusal to boot.
 *
 * There is deliberately no bypass flag and no `dev-login` route. A forgery
 * path that exists but is "switched off" is one environment variable away from
 * being switched on.
 */
export function assertApsHostsAreAutodesk(): void {
  if (env.isDev) return;
  const { ok, offenders } = apsHostsAreAutodesk();
  if (ok) return;
  throw new Error(
    `Refusing to start: identity must come from Autodesk, but ${offenders.join(', ')}. `
    + 'Unset these in production — they exist only so tests can run the real '
    + 'sign-in code against a local issuer.',
  );
}
