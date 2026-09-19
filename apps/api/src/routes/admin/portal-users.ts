import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import {
  can, createPortalUserSchema, patchPortalUserSchema, reasonSchema, type PortalRole,
} from '@app/shared';
import { hashPassword } from '@app/core';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { uuidParam } from '../../lib/params';
import { requireGlobal, requireStepUp, type PortalUser } from '../../middleware/auth';
import { audit } from '../../middleware/audit';

export const portalUsers = new Hono();

/**
 * Portal staff only, reads included. An organisation admin has no business
 * on this surface at all — not even to look at their own row, which is what
 * the account page is for — and the one thing they must never reach is a
 * PATCH on themselves.
 */
portalUsers.use('*', requireGlobal());

/**
 * Never select the whole row for a portal user: it carries `password_hash`
 * and `totp_secret_enc`, and anything selected here ends up in a JSON
 * response and in audit before/after state.
 */
export const SAFE_COLUMNS = {
  id: s.portalUsers.id,
  email: s.portalUsers.email,
  displayName: s.portalUsers.displayName,
  role: s.portalUsers.role,
  orgId: s.portalUsers.orgId,
  isActive: s.portalUsers.isActive,
  mustChangePassword: s.portalUsers.mustChangePassword,
  totpEnabled: s.portalUsers.totpEnabled,
  totpResetRequired: s.portalUsers.totpResetRequired,
  sessionEpoch: s.portalUsers.sessionEpoch,
  lastLoginAt: s.portalUsers.lastLoginAt,
  createdAt: s.portalUsers.createdAt,
};

/**
 * Who may change or reset a given portal user. Owners manage everybody.
 * `org_admin.manage` (owner and admin) covers organisation admins only — an
 * admin deactivating a customer's admin is routine, an admin deactivating
 * another portal admin is not.
 */
function assertMayManage(actor: PortalUser, target: { role: PortalRole }): void {
  if (actor.role === 'owner') return;
  if (target.role === 'org_admin' && can(actor.role, 'org_admin.manage')) return;
  throw forbidden();
}

portalUsers.get('/', async (c) => {
  const rows = await db.select({ ...SAFE_COLUMNS, orgName: s.organizations.name })
    .from(s.portalUsers)
    .leftJoin(s.organizations, eq(s.organizations.id, s.portalUsers.orgId))
    .orderBy(s.portalUsers.email);
  return c.json({ rows });
});

/**
 * Destructive: creates a new operator account. Owner only, step-up required.
 * Global roles only — the schema refuses `org_admin`, which is minted by
 * `POST /admin/orgs/:id/portal-users` with the organisation taken from the
 * path, so no body can produce an org admin with nothing to administer.
 */
portalUsers.post('/', async (c) => {
  requireStepUp(c);
  const actor = c.get('portalUser');
  if (actor.role !== 'owner') throw forbidden();

  const body = createPortalUserSchema.parse(await c.req.json());
  const email = body.email.trim().toLowerCase();

  const [clash] = await db.select({ id: s.portalUsers.id }).from(s.portalUsers)
    .where(eq(s.portalUsers.email, email)).limit(1);
  if (clash) throw conflict('A portal user with that email already exists');

  const passwordHash = await hashPassword(body.password);
  const [row] = await db.insert(s.portalUsers).values({
    email,
    displayName: body.displayName,
    role: body.role,
    passwordHash,
    passwordChangedAt: new Date(),
    // They enrol their own authenticator at first login; no operator ever
    // sees or transports someone else's TOTP secret.
    totpResetRequired: true,
    createdBy: actor.id,
  }).returning(SAFE_COLUMNS);

  await audit(c, {
    action: 'portal_user.create',
    targetType: 'portal_user',
    targetId: row!.id,
    after: { email: row!.email, role: row!.role, isActive: row!.isActive },
  });

  return c.json({ row }, 201);
});

/**
 * PATCH /admin/portal-users/:id
 *
 * Role changes and deactivation both bump `session_epoch`, so the change
 * takes effect on the target's very next request rather than whenever their
 * eight-hour token happens to expire.
 */
portalUsers.patch('/:id', async (c) => {
  const id = uuidParam(c);
  const actor = c.get('portalUser');
  const body = patchPortalUserSchema.parse(await c.req.json());

  const [before] = await db.select(SAFE_COLUMNS).from(s.portalUsers)
    .where(eq(s.portalUsers.id, id)).limit(1);
  if (!before) throw notFound();
  assertMayManage(actor, before);

  // Lock-out guard: an owner who demotes or disables themselves can leave the
  // portal with no one able to administer it.
  if (actor.id === id) {
    if (body.role && body.role !== before.role) throw badRequest('You cannot change your own role');
    if (body.isActive === false) throw badRequest('You cannot deactivate your own account');
  }

  // The scoped role is entered and left by no PATCH. The schema already
  // refuses `org_admin` as a target role; this refuses leaving it, so an org
  // admin cannot be turned into a global role while still carrying an org_id
  // (which the CHECK constraint would reject as a 500 anyway) and, more to
  // the point, so the organisation an admin belongs to is immutable. A new
  // account is how somebody moves.
  if (body.role !== undefined && body.role !== before.role && before.role === 'org_admin') {
    throw badRequest('An organisation admin cannot be given a portal role. Deactivate this account and create a new one.');
  }

  if ((body.role && body.role !== 'owner' && before.role === 'owner') || body.isActive === false) {
    const [owners] = await db.select({ n: sql<number>`count(*)::int` }).from(s.portalUsers)
      .where(sql`${s.portalUsers.role} = 'owner' AND ${s.portalUsers.isActive} AND ${s.portalUsers.id} <> ${id}`);
    if (before.role === 'owner' && (owners?.n ?? 0) === 0) {
      throw badRequest('This is the last active owner');
    }
  }

  const revokes = (body.role !== undefined && body.role !== before.role)
    || (body.isActive !== undefined && body.isActive !== before.isActive);

  const [row] = await db.update(s.portalUsers).set({
    displayName: body.displayName ?? undefined,
    role: body.role ?? undefined,
    isActive: body.isActive ?? undefined,
    sessionEpoch: revokes ? sql`${s.portalUsers.sessionEpoch} + 1` : undefined,
    updatedAt: new Date(),
  }).where(eq(s.portalUsers.id, id)).returning(SAFE_COLUMNS);

  await audit(c, {
    orgId: before.orgId,
    action: 'portal_user.update',
    targetType: 'portal_user',
    targetId: id,
    before,
    after: { ...row, sessionsRevoked: revokes },
  });
  return c.json({ row });
});

/** Destructive: strips someone's second factor. Step-up required. */
portalUsers.post('/:id/reset-totp', async (c) => {
  requireStepUp(c);
  const id = uuidParam(c);
  const actor = c.get('portalUser');
  const { reason } = reasonSchema.parse(await c.req.json());

  const [before] = await db.select(SAFE_COLUMNS).from(s.portalUsers)
    .where(eq(s.portalUsers.id, id)).limit(1);
  if (!before) throw notFound();
  assertMayManage(actor, before);

  const [row] = await db.update(s.portalUsers).set({
    totpSecretEnc: null,
    totpEnabled: false,
    totpResetRequired: true,
    // Anyone holding a session for this account loses it immediately: a TOTP
    // reset is what you do when you suspect the account is compromised.
    sessionEpoch: sql`${s.portalUsers.sessionEpoch} + 1`,
    updatedAt: new Date(),
  }).where(eq(s.portalUsers.id, id)).returning(SAFE_COLUMNS);

  await audit(c, {
    orgId: before.orgId,
    action: 'portal.totp_reset',
    targetType: 'portal_user',
    targetId: id,
    before,
    after: { ...row, reason },
  });
  return c.json({ ok: true, row });
});
