import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifyPortalJwt, type PortalClaims } from '@app/core';
import { eq } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { env } from '../env';
import { unauthorized, forbidden, notFound, conflict, HttpError } from '../lib/errors';
import { can, type Capability, type PortalRole } from '@app/shared';

export type PortalUser = typeof s.portalUsers.$inferSelect;
export type ScopedOrg = typeof s.organizations.$inferSelect;

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    portalClaims: PortalClaims;
    portalUser: PortalUser;
    /**
     * The organisation an `org_admin` is confined to, or null for every
     * global role. Set once per request by `requireSession`; every scoped
     * read and write consults it through the helpers below.
     */
    orgScope: string | null;
    scopedOrg: ScopedOrg | null;
  }
}

const PUBLIC_ADMIN = new Set([
  '/admin/auth/login',
  '/admin/auth/dev-hint',
]);

/**
 * What a session may reach while its owner still has to set a password of
 * their own. An organisation admin's first password was chosen by whoever
 * created the account, so until it is replaced the session can finish TOTP
 * enrolment, change the password, ask who it is, and leave — nothing else.
 * Same shape as the enrolment gate, which it runs after.
 */
const MUST_CHANGE_ALLOWED = [
  '/admin/auth/totp/',
  '/admin/auth/password',
  '/admin/auth/me',
  '/admin/auth/logout',
];

export async function requireSession(c: Context, next: Next) {
  if (PUBLIC_ADMIN.has(c.req.path)) {
    await next();
    return;
  }

  const token = bearer(c) ?? getCookie(c, env.cookieName);
  if (!token) throw unauthorized();

  let claims: PortalClaims;
  try {
    claims = await verifyPortalJwt(token);
  } catch {
    throw unauthorized();
  }

  const user = await db.query.portalUsers.findFirst({
    where: eq(s.portalUsers.id, claims.sub),
  });
  if (!user?.isActive) throw unauthorized();
  if (user.sessionEpoch !== claims.epoch) throw unauthorized();

  if (claims.typ === 'enrol' && !c.req.path.startsWith('/admin/auth/totp')) {
    throw unauthorized('TOTP enrolment required');
  }

  if (user.mustChangePassword && !MUST_CHANGE_ALLOWED.some((p) => c.req.path.startsWith(p))) {
    // 403 with its own code, not 401: the session is valid, the person is who
    // they say they are, and the portal needs to send them to the password
    // page rather than back to the login form.
    throw new HttpError(403, 'password_change_required', 'Set a new password before continuing');
  }

  // The scope is loaded from the row on every request, never from the
  // cookie, so an admin whose organisation was deleted is out at once rather
  // than at cookie expiry. The CHECK constraint guarantees an org_admin has an
  // org_id; a row that somehow lacks one, or names an organisation that is
  // gone, has nothing to administer and is refused outright.
  let scopedOrg: ScopedOrg | null = null;
  if (user.role === 'org_admin') {
    if (!user.orgId) throw unauthorized();
    const [org] = await db.select().from(s.organizations)
      .where(eq(s.organizations.id, user.orgId)).limit(1);
    if (!org) throw unauthorized();
    scopedOrg = org;
  }

  c.set('portalClaims', claims);
  c.set('portalUser', user);
  c.set('orgScope', scopedOrg?.id ?? null);
  c.set('scopedOrg', scopedOrg);
  await next();
}

export function requireRole(...roles: PortalRole[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('portalUser');
    if (!user || !roles.includes(user.role)) throw forbidden();
    await next();
  };
}

/**
 * Refuse a request the caller's role does not carry the capability for.
 *
 * Every mutating admin route goes through one of these. Reads are deliberately
 * not gated: a viewer is a role that sees everything and changes nothing, so
 * the boundary belongs on the writes. (The organisation admin is the one
 * exception, handled by the scope helpers below rather than here.)
 *
 * The message names the capability on purpose. This is an authenticated
 * operator being told which permission they are missing, not an anonymous
 * caller being given a map of the system.
 */
export function requireCapability(capability: Capability) {
  return async (c: Context, next: Next) => {
    const user = c.get('portalUser');
    if (!can(user?.role, capability)) {
      throw forbidden(`Your role does not allow this. Required capability: ${capability}`);
    }
    await next();
  };
}

export function requireStepUp(c: Context) {
  const claims = c.get('portalClaims');
  const at = claims.last_reauth_at ?? 0;
  if (Date.now() / 1000 - at > 5 * 60) {
    throw forbidden('Step-up TOTP required');
  }
}

/* --------------------------------------------------------------- scope --- */

/**
 * The organisation scope layer.
 *
 * An organisation admin is the first portal role whose READS have to be
 * confined, and "reads are open" was load-bearing everywhere. Rather than
 * thread a role check through every handler, each read route asks one of
 * these three questions:
 *
 *   - `requireGlobal()` — this whole surface is for portal staff (dashboard,
 *     licences list, access requests, panels, portal users). Router-level.
 *   - `assertOrgAccess(c, rowOrgId)` — this row was loaded by id; may the
 *     caller see it? Answers 404, never 403, so another customer's ids can
 *     not be confirmed by probing.
 *   - `scopedOrgFilter(c, requested)` — this is a list with an `?org=` filter;
 *     force it to the scope. An explicit request for a *different* org is a
 *     403: the caller already knows that id and is asking for something they
 *     were told they cannot have, which is worth being clear about.
 *
 * Global roles pass through all three untouched.
 */
export function orgScope(c: Context): string | null {
  return c.get('orgScope') ?? null;
}

export function assertOrgAccess(c: Context, rowOrgId: string | null | undefined): void {
  const scope = orgScope(c);
  if (scope && rowOrgId !== scope) throw notFound();
}

export function scopedOrgFilter(c: Context, requested?: string): string | undefined {
  const scope = orgScope(c);
  if (!scope) return requested;
  if (requested && requested !== scope) throw forbidden('That organisation is outside your scope');
  return scope;
}

/**
 * A suspended organisation is read-only for its admins. They can still sign
 * in and see the queue, but every mutation stops here: an organisation is
 * suspended by portal staff for a reason, and letting its own admins keep
 * seating people would undo it. Portal staff are not held by this — they are
 * the ones who can lift the suspension.
 */
export function assertOrgWritable(c: Context): void {
  const org = c.get('scopedOrg');
  if (org && org.status === 'suspended') {
    throw conflict('This organisation is suspended. Members cannot be changed until it is reactivated.');
  }
}

/** Router-level: this surface is for portal staff only. */
export function requireGlobal() {
  return async (c: Context, next: Next) => {
    if (orgScope(c)) throw forbidden('This area is for portal administrators');
    await next();
  };
}

function bearer(c: Context): string | undefined {
  const h = c.req.header('authorization');
  if (!h?.startsWith('Bearer ')) return undefined;
  return h.slice(7);
}
