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
