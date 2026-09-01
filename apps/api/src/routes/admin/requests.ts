import { Hono } from 'hono';
import { desc, eq, or, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { approveRequestSchema, rejectRequestSchema, requestQuerySchema } from '@app/shared';
import { notFound, badRequest, conflict } from '../../lib/errors';

import {
  assertRoleAssignable, assertSeatAvailable, defaultRoleKey,
} from '../../lib/seats';
import { audit } from '../../middleware/audit';

export const requests = new Hono();

requests.get('/', async (c) => {
  const { status } = requestQuerySchema.parse({ status: c.req.query('status') || undefined });
  const rows = await db.select().from(s.accessRequests)
    .where(eq(s.accessRequests.status, status))
    .orderBy(desc(s.accessRequests.lastAttemptAt))
    .limit(200);
  return c.json({ rows });
});

requests.post('/:id/approve', async (c) => {
  const id = c.req.param('id');
  const body = approveRequestSchema.parse(await c.req.json());
  const actor = c.get('portalUser');

  const [reqRow] = await db.select().from(s.accessRequests).where(eq(s.accessRequests.id, id)).limit(1);
  if (!reqRow) throw notFound();
  if (reqRow.status !== 'pending') throw badRequest('Request is not pending');

  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, body.orgId)).limit(1);
  if (!org) throw notFound('Organisation not found');

  // One person, one org. Approving someone who already has a membership
  // would violate the global unique on email/autodesk_id and 500 the route.
  const [clash] = await db.select().from(s.orgUsers)
    .where(or(
      eq(s.orgUsers.email, reqRow.email),
      reqRow.autodeskId ? eq(s.orgUsers.autodeskId, reqRow.autodeskId) : sql`false`,
    ))
    .limit(1);
  if (clash) {
    throw conflict('This person already has a membership. Move them with a transfer, then approve.');
  }

  // Approving consumes a seat like any other assignment, so it can fail when
  // the role is full -- better here, with a message naming the count, than by
  // creating a member the licence does not cover.
  const roleKey = body.roleKey ?? await defaultRoleKey(db);
  await assertRoleAssignable(db, roleKey);
  await assertSeatAvailable(db, body.orgId, roleKey);

  const created = await db.transaction(async (tx) => {
    const [user] = await tx.insert(s.orgUsers).values({
      orgId: body.orgId,
      email: reqRow.email,
      autodeskId: reqRow.autodeskId,
      emailVerified: reqRow.emailVerified,
      displayName: reqRow.displayName,
      roleKey,
      source: 'approved_request',
      createdBy: actor.id,
    }).returning();

    const [row] = await tx.update(s.accessRequests).set({
      status: 'approved',
      assignedOrgId: body.orgId,
      grantedRoleKey: roleKey,
      reviewedBy: actor.id,
      reviewedAt: new Date(),
    }).where(eq(s.accessRequests.id, id)).returning();

    return { user: user!, row: row! };
  });

  await audit(c, {
    orgId: body.orgId,
    action: 'request.approve',
    targetType: 'access_request',
    targetId: id,
    before: reqRow,
    after: { request: created.row, user: created.user },
  });
  return c.json({ row: created.row, user: created.user });
});

requests.post('/:id/reject', async (c) => {
  const id = c.req.param('id');
  const body = rejectRequestSchema.parse(await c.req.json());
  const actor = c.get('portalUser');

  const [before] = await db.select().from(s.accessRequests).where(eq(s.accessRequests.id, id)).limit(1);
  if (!before) throw notFound();
  if (before.status !== 'pending') throw badRequest('Request is not pending');

  const [row] = await db.update(s.accessRequests).set({
    status: 'rejected',
    reviewNote: body.note,
    reviewedBy: actor.id,
    reviewedAt: new Date(),
  }).where(eq(s.accessRequests.id, id)).returning();

  await audit(c, {
    orgId: before.assignedOrgId,
    action: 'request.reject',
    targetType: 'access_request',
    targetId: id,
    before,
    after: row,
  });
  return c.json({ row });
});
