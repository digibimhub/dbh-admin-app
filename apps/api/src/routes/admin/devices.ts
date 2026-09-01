import { Hono } from 'hono';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { deviceQuerySchema, reasonSchema, usageQuerySchema } from '@app/shared';
import { notFound } from '../../lib/errors';
import { audit } from '../../middleware/audit';

export const devices = new Hono();

devices.get('/', async (c) => {
  const q = deviceQuerySchema.parse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    q: c.req.query('q'),
    org: c.req.query('org') || undefined,
    status: c.req.query('status') || undefined,
    revit: c.req.query('revit') || undefined,
  });

  const filters = [];
  if (q.org) filters.push(eq(s.devices.orgId, q.org));
  if (q.status) filters.push(eq(s.devices.status, q.status));
  if (q.revit) filters.push(sql`${q.revit} = ANY(${s.devices.revitVersions})`);
  if (q.q) filters.push(or(ilike(s.devices.machineName, `%${q.q}%`), ilike(s.devices.deviceHash, `%${q.q}%`)));
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db.select({
    device: s.devices,
    orgName: s.organizations.name,
    userEmail: s.orgUsers.email,
    userName: s.orgUsers.displayName,
  }).from(s.devices)
    .innerJoin(s.organizations, eq(s.organizations.id, s.devices.orgId))
    .leftJoin(s.orgUsers, eq(s.orgUsers.id, s.devices.orgUserId))
    .where(where)
    .orderBy(desc(s.devices.lastSeenAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(s.devices).where(where);
  return c.json({ rows, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize });
});

devices.post('/:id/disable', async (c) => {
  const id = c.req.param('id');
  const { reason } = reasonSchema.parse(await c.req.json());
  const actor = c.get('portalUser');

  const [before] = await db.select().from(s.devices).where(eq(s.devices.id, id)).limit(1);
  if (!before) throw notFound();

  const [row] = await db.update(s.devices).set({
    status: 'disabled',
    updatedAt: new Date(),
  }).where(eq(s.devices.id, id)).returning();

  await audit(c, {
    orgId: before.orgId,
    action: 'device.disable',
    targetType: 'device',
    targetId: id,
    before,
    after: row,
  });
  return c.json({ row });
});

devices.post('/:id/enable', async (c) => {
  const id = c.req.param('id');
  const [before] = await db.select().from(s.devices).where(eq(s.devices.id, id)).limit(1);
  if (!before) throw notFound();

  const [row] = await db.update(s.devices).set({
    status: 'active',
    updatedAt: new Date(),
  }).where(eq(s.devices.id, id)).returning();

  await audit(c, {
    orgId: before.orgId,
    action: 'device.enable',
    targetType: 'device',
    targetId: id,
    before,
    after: row,
  });
  return c.json({ row });
});

/**
 * GET /admin/devices/:id/usage?days=30
 *
 * Daily heartbeats and minutes for one workstation, plus its command mix.
 * This is the view support opens when a customer says "the add-in stopped
 * working on that machine last week".
 */
devices.get('/:id/usage', async (c) => {
  const id = c.req.param('id');
  const { days } = usageQuerySchema.parse({ days: c.req.query('days') ?? undefined });

  const [device] = await db.select().from(s.devices).where(eq(s.devices.id, id)).limit(1);
  if (!device) throw notFound();

  const daily = await db.select({
    usageDate: s.usageDaily.usageDate,
    launches: s.usageDaily.launches,
    heartbeats: s.usageDaily.heartbeats,
    activeMinutes: s.usageDaily.activeMinutes,
    revitVersion: s.usageDaily.revitVersion,
    addinVersion: s.usageDaily.addinVersion,
    userEmail: s.orgUsers.email,
  }).from(s.usageDaily)
    .leftJoin(s.orgUsers, eq(s.orgUsers.id, s.usageDaily.orgUserId))
    .where(and(
      eq(s.usageDaily.deviceId, id),
      sql`${s.usageDaily.usageDate} >= CURRENT_DATE - ${days}::int`,
    ))
    .orderBy(s.usageDaily.usageDate);

  const [totals] = await db.select({
    launches: sql<number>`COALESCE(sum(${s.usageDaily.launches}), 0)::int`,
    heartbeats: sql<number>`COALESCE(sum(${s.usageDaily.heartbeats}), 0)::int`,
    activeMinutes: sql<number>`COALESCE(sum(${s.usageDaily.activeMinutes}), 0)::int`,
    activeDays: sql<number>`count(*)::int`,
  }).from(s.usageDaily)
    .where(and(
      eq(s.usageDaily.deviceId, id),
      sql`${s.usageDaily.usageDate} >= CURRENT_DATE - ${days}::int`,
    ));

  return c.json({
    device,
    days,
    totals: totals ?? { launches: 0, heartbeats: 0, activeMinutes: 0, activeDays: 0 },
    daily,
  });
});
