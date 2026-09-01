import './env';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { assertApsHostsAreAutodesk, env, ensureEncryptionKey } from './env';
import { errorHandler, requestId } from './middleware/error';
import { rateLimit, clientIp } from './middleware/ratelimit';
import { requireSession } from './middleware/auth';
import { auditMutations } from './middleware/audit';
import { adminAuth } from './routes/admin/auth';
import { dashboard } from './routes/admin/dashboard';
import { organizations } from './routes/admin/organizations';
import { domains } from './routes/admin/domains';
import { licenses } from './routes/admin/licenses';
import { users } from './routes/admin/users';
import { devices } from './routes/admin/devices';
import { requests } from './routes/admin/requests';
import { panels } from './routes/admin/panels';
import { portalUsers } from './routes/admin/portal-users';
import { audit } from './routes/admin/audit';
import { roles } from './routes/admin/roles';
import { addinAuth } from './routes/addin/auth';
import { addinValidate } from './routes/addin/validate';
import { addinTelemetry } from './routes/addin/telemetry';
import { getSigningKey, jwks } from './lib/signing';
import { startJobs } from './jobs';

ensureEncryptionKey();

if (!env.isDev && !env.turnstileSecret) {
  // Turnstile is skipped when the secret is empty, which is right for local
  // development and very wrong in production — it would silently drop the
  // bot check on the login form.
  throw new Error('TURNSTILE_SECRET is required in production');
}

const app = new Hono();

app.use('*', requestId);
// Logs method, path and status. Never bodies: they carry passwords, TOTP
// codes, refresh tokens and APS credentials.
app.use('*', logger());
app.use('*', cors({
  origin: [env.adminUrl, 'http://localhost:3000'],
  credentials: true,
  allowHeaders: ['content-type', 'authorization', 'x-request-id'],
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.onError(errorHandler);

app.get('/health', (c) => c.json({ ok: true }));

/**
 * Public keys for offline verification in the add-in, and the reason key
 * rotation does not need a new DLL. Rate-limited like every other public
 * endpoint, and cached: the key set changes on the order of months.
 */
app.get(
  '/.well-known/jwks.json',
  rateLimit({ windowMs: 60_000, max: 60, key: clientIp, bucket: 'jwks' }),
  async (c) => {
    c.header('cache-control', 'public, max-age=3600');
    return c.json(await jwks());
  },
);

/* ------------------------------------------------------------- add-in API */

app.use('/v1/*', rateLimit({
  windowMs: 60_000,
  max: 30,
  key: (c) => c.req.header('x-device-hash') ?? clientIp(c),
  bucket: 'v1',
}));
app.route('/v1/auth', addinAuth);
app.route('/v1/token', addinValidate);
app.route('/v1/telemetry', addinTelemetry);

/* -------------------------------------------------------------- admin API */

app.use('/admin/*', rateLimit({ windowMs: 60_000, max: 120, key: clientIp, bucket: 'admin' }));
app.use('/admin/*', requireSession);
// Auto-writes audit_log on every non-GET. Routes that call audit() supply
// before/after; this is the safety net for anything that forgets.
app.use('/admin/*', auditMutations);

app.route('/admin/auth', adminAuth);
app.route('/admin/dashboard', dashboard);
app.route('/admin/orgs', organizations);
// Mounted at /admin because these own paths under both /orgs/:id and their
// own collection: /admin/orgs/:id/domains and /admin/domains/:id/verify.
app.route('/admin', domains);
app.route('/admin', licenses);
app.route('/admin/users', users);
app.route('/admin/devices', devices);
app.route('/admin/access-requests', requests);
app.route('/admin/panels', panels);
app.route('/admin/portal-users', portalUsers);
app.route('/admin/audit-log', audit);
app.route('/admin/roles', roles);

// Before the socket opens: identity must come from Autodesk, and in production
// nothing may have repointed it. Throwing here is deliberate — a process that
// refuses to start is a far better failure than one that starts and trusts the
// wrong issuer.
assertApsHostsAreAutodesk();

serve({ fetch: app.fetch, port: env.apiPort }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
  console.log(`Admin origin: ${env.adminUrl}`);

  // Load and publish the signing key now, so the first token refresh does not
  // have to do it from inside its transaction.
  void getSigningKey().catch((e: unknown) => {
    console.error(`Signing key unavailable: ${e instanceof Error ? e.message : String(e)}`);
  });

  startJobs();
});

export { app };
