import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifyPortalJwt, type PortalClaims } from '@app/core';
import { eq } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { env } from '../env';
import { unauthorized, forbidden } from '../lib/errors';
import { can, type Capability, type PortalRole } from '@app/shared';

export type PortalUser = typeof s.portalUsers.$inferSelect;

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    portalClaims: PortalClaims;
    portalUser: PortalUser;
  }
}

const PUBLIC_ADMIN = new Set([
  '/admin/auth/login',
  '/admin/auth/dev-hint',
]);

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

  c.set('portalClaims', claims);
  c.set('portalUser', user);
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
 * the boundary belongs on the writes.
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

function bearer(c: Context): string | undefined {
  const h = c.req.header('authorization');
  if (!h?.startsWith('Bearer ')) return undefined;
  return h.slice(7);
}
