import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { createPortalUserSchema, patchPortalUserSchema, reasonSchema } from '@app/shared';
import { hashPassword } from '@app/core';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';

import { requireStepUp } from '../../middleware/auth';
import { audit } from '../../middleware/audit';

export const portalUsers = new Hono();

/**
 * Never select the whole row for a portal user: it carries `password_hash`
 * and `totp_secret_enc`, and anything selected here ends up in a JSON
 * response and in audit before/after state.
 */
const SAFE_COLUMNS = {
  id: s.portalUsers.id,
  email: s.portalUsers.email,
  displayName: s.portalUsers.displayName,
  role: s.portalUsers.role,
  isActive: s.portalUsers.isActive,
  totpEnabled: s.portalUsers.totpEnabled,
  totpResetRequired: s.portalUsers.totpResetRequired,
  sessionEpoch: s.portalUsers.sessionEpoch,
  lastLoginAt: s.portalUsers.lastLoginAt,
  createdAt: s.portalUsers.createdAt,
};

portalUsers.get('/', async (c) => {
  const rows = await db.select(SAFE_COLUMNS).from(s.portalUsers).orderBy(s.portalUsers.email);
  return c.json({ rows });
});

/** Destructive: creates a new operator account. Owner only, step-up required. */
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
  const id = c.req.param('id');
  const actor = c.get('portalUser');
  if (actor.role !== 'owner') throw forbidden();

  const body = patchPortalUserSchema.parse(await c.req.json());

  const [before] = await db.select(SAFE_COLUMNS).from(s.portalUsers)
    .where(eq(s.portalUsers.id, id)).limit(1);
  if (!before) throw notFound();

  // Lock-out guard: an owner who demotes or disables themselves can leave the
  // portal with no one able to administer it.
  if (actor.id === id) {
    if (body.role && body.role !== before.role) throw badRequest('You cannot change your own role');
    if (body.isActive === false) throw badRequest('You cannot deactivate your own account');
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
    action: 'portal_user.update',
    targetType: 'portal_user',
    targetId: id,
    before,
    after: { ...row, sessionsRevoked: revokes },
  });
  return c.json({ row });
});

/** Destructive: strips someone's second factor. Owner only, step-up required. */
portalUsers.post('/:id/reset-totp', async (c) => {
  requireStepUp(c);
  const actor = c.get('portalUser');
  if (actor.role !== 'owner') throw forbidden();

  const id = c.req.param('id');
  const { reason } = reasonSchema.parse(await c.req.json());

  const [before] = await db.select(SAFE_COLUMNS).from(s.portalUsers)
    .where(eq(s.portalUsers.id, id)).limit(1);
  if (!before) throw notFound();

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
    action: 'portal.totp_reset',
    targetType: 'portal_user',
    targetId: id,
    before,
    after: { ...row, reason },
  });
  return c.json({ ok: true, row });
});
