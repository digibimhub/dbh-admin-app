import { Hono } from 'hono';
import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { createOrgSchema, patchOrgSchema, orgQuerySchema, reasonSchema } from '@app/shared';
import { notFound, conflict } from '../../lib/errors';
import { uuidParam } from '../../lib/params';
import { requireStepUp, requireCapability } from '../../middleware/auth';
import { audit } from '../../middleware/audit';

export const organizations = new Hono();

/**
 * Seats for one licence, with occupancy counted per role.
 *
 * `used` is a COUNT, never a stored tally — which is what makes moving a
 * person between roles correct with no bookkeeping: the same statement that
 * changes `role_key` moves them from one bucket to the other.
 */
async function seatsFor(licenseId: string, orgId: string) {
  const rows = await db
    .select({
      roleKey: s.licenseRoles.roleKey,
      seats: s.licenseRoles.seats,
      name: s.roles.name,
      sortOrder: s.roles.sortOrder,
      isActive: s.roles.isActive,
    })
    .from(s.licenseRoles)
    .innerJoin(s.roles, eq(s.roles.key, s.licenseRoles.roleKey))
    .where(eq(s.licenseRoles.licenseId, licenseId))
    .orderBy(asc(s.roles.sortOrder));

  const occupancy = await db
    .select({ roleKey: s.orgUsers.roleKey, n: count() })
    .from(s.orgUsers)
    .where(and(eq(s.orgUsers.orgId, orgId), eq(s.orgUsers.status, 'active')))
    .groupBy(s.orgUsers.roleKey);
  const used = new Map(occupancy.map((o) => [o.roleKey, o.n]));

  return rows.map((r) => ({ ...r, used: used.get(r.roleKey) ?? 0 }));
}

organizations.get('/', async (c) => {
  const q = orgQuerySchema.parse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    q: c.req.query('q'),
    status: c.req.query('status') || undefined,
  });

  const filters = [];
  if (q.q) filters.push(or(ilike(s.organizations.name, `%${q.q}%`), ilike(s.organizations.slug, `%${q.q}%`)));
  if (q.status) filters.push(eq(s.organizations.status, q.status));
  const where = filters.length ? and(...filters) : undefined;

  /**
   * The list carries its licence and its people counts.
   *
   * These used to be a second request the browser joined by hand, and the user
   * count had no endpoint at all — so the two numbers a plan is sold on were
   * on neither the list nor its drawer. One left join and three grouped counts
   * are cheaper than the round trip that replaced them, and the compiler
   * checks this where the retired v_org_summary view could not.
   */
  const rows = await db
    .select({
      org: s.organizations,
      licenseId: s.licenses.id,
      mode: s.licenses.mode,
      endDate: s.licenses.endDate,
    })
    .from(s.organizations)
    .leftJoin(
      s.licenses,
      and(eq(s.licenses.orgId, s.organizations.id), eq(s.licenses.status, 'active')),
    )
    .where(where)
    .orderBy(s.organizations.name)
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  const ids = rows.map((r) => r.org.id);
  const people = ids.length
    ? await db.select({ orgId: s.orgUsers.orgId, n: count() }).from(s.orgUsers)
        .where(and(inArray(s.orgUsers.orgId, ids), eq(s.orgUsers.status, 'active')))
        .groupBy(s.orgUsers.orgId)
    : [];
  const pending = ids.length
    ? await db.select({ orgId: s.orgUsers.orgId, n: count() }).from(s.orgUsers)
        .where(and(inArray(s.orgUsers.orgId, ids), eq(s.orgUsers.status, 'pending')))
        .groupBy(s.orgUsers.orgId)
    : [];
  const seatTotals = ids.length
    ? await db.select({
        orgId: s.licenses.orgId,
        n: sql<number>`coalesce(sum(${s.licenseRoles.seats}), 0)::int`,
      })
        .from(s.licenseRoles)
        .innerJoin(s.licenses, eq(s.licenses.id, s.licenseRoles.licenseId))
        .where(and(inArray(s.licenses.orgId, ids), eq(s.licenses.status, 'active')))
        .groupBy(s.licenses.orgId)
    : [];

  const activeBy = new Map(people.map((p) => [p.orgId, p.n]));
  const pendingBy = new Map(pending.map((p) => [p.orgId, p.n]));
  const seatsBy = new Map(seatTotals.map((p) => [p.orgId, p.n]));

  const [total] = await db.select({ n: count() }).from(s.organizations).where(where);

  return c.json({
    rows: rows.map((r) => ({
      ...r.org,
      mode: r.mode ?? null,
      licenseEnd: r.endDate ?? null,
      activeUsers: activeBy.get(r.org.id) ?? 0,
      pendingUsers: pendingBy.get(r.org.id) ?? 0,
      totalSeats: seatsBy.get(r.org.id) ?? 0,
    })),
    total: total?.n ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  });
});

organizations.post('/', requireCapability('org.create'), async (c) => {
  const body = createOrgSchema.parse(await c.req.json());
  const user = c.get('portalUser');
  try {
    const [row] = await db.insert(s.organizations).values({ ...body, createdBy: user.id }).returning();
    await audit(c, {
      orgId: row!.id,
      action: 'org.create',
      targetType: 'organization',
      targetId: row!.id,
      after: row,
    });
    return c.json({ row }, 201);
  } catch (e: unknown) {
    if (String(e).includes('unique')) {
      throw conflict(`The slug "${body.slug}" is already in use.`);
    }
    throw e;
  }
});

organizations.get('/:id', async (c) => {
  const id = uuidParam(c);
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, id)).limit(1);
  if (!org) throw notFound('Organisation not found');

  const [license] = await db.select().from(s.licenses)
    .where(and(eq(s.licenses.orgId, id), eq(s.licenses.status, 'active'))).limit(1);

  const [users] = await db.select({ n: count() }).from(s.orgUsers)
    .where(and(eq(s.orgUsers.orgId, id), eq(s.orgUsers.status, 'active')));
  const [waiting] = await db.select({ n: count() }).from(s.orgUsers)
    .where(and(eq(s.orgUsers.orgId, id), eq(s.orgUsers.status, 'pending')));
  const [devices] = await db.select({ n: count() }).from(s.devices)
    .where(and(eq(s.devices.orgId, id), eq(s.devices.status, 'active')));
  const [lastActive] = await db
    .select({ at: sql<string | null>`max(${s.orgUsers.lastActivityAt})` })
    .from(s.orgUsers).where(eq(s.orgUsers.orgId, id));

  const domains = await db.select().from(s.orgDomains)
    .where(eq(s.orgDomains.orgId, id))
    .orderBy(asc(s.orgDomains.value));

  const seats = license ? await seatsFor(license.id, id) : [];

  return c.json({
    org,
    license: license ?? null,
    domains,
    seats,
    counts: {
      users: users?.n ?? 0,
      pending: waiting?.n ?? 0,
      devices: devices?.n ?? 0,
    },
    lastActivityAt: lastActive?.at ?? null,
  });
});

organizations.patch('/:id', requireCapability('org.edit'), async (c) => {
  const id = uuidParam(c);
  const body = patchOrgSchema.parse(await c.req.json());
  const [before] = await db.select().from(s.organizations).where(eq(s.organizations.id, id)).limit(1);
  if (!before) throw notFound();

  const [row] = await db.update(s.organizations)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(s.organizations.id, id))
    .returning();

  await audit(c, {
    orgId: id,
    action: 'org.update',
    targetType: 'organization',
    targetId: id,
    before,
    after: row,
  });
  return c.json({ row });
});

/** Destructive: cuts off every user in the org at their next heartbeat. */
organizations.post('/:id/suspend', requireCapability('org.suspend'), async (c) => {
  requireStepUp(c);
  const id = uuidParam(c);
  // A suspension with no recorded reason is the row support cannot explain six
  // months later. The licence suspend route has always required one; this one
  // silently accepted an empty body.
  const { reason } = reasonSchema.parse(await c.req.json());

  const [before] = await db.select().from(s.organizations).where(eq(s.organizations.id, id)).limit(1);
  if (!before) throw notFound();

  const [row] = await db.update(s.organizations)
    .set({ status: 'suspended', updatedAt: new Date() })
    .where(eq(s.organizations.id, id))
    .returning();

  await audit(c, {
    orgId: id,
    action: 'org.suspend',
    targetType: 'organization',
    targetId: id,
    before,
    after: { ...row, reason },
  });
  return c.json({ row });
});

organizations.post('/:id/reactivate', requireCapability('org.suspend'), async (c) => {
  const id = uuidParam(c);
  const [before] = await db.select().from(s.organizations).where(eq(s.organizations.id, id)).limit(1);
  if (!before) throw notFound();

  const [row] = await db.update(s.organizations)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(s.organizations.id, id))
    .returning();

  await audit(c, {
    orgId: id,
    action: 'org.reactivate',
    targetType: 'organization',
    targetId: id,
    before,
    after: row,
  });
  return c.json({ row });
});
