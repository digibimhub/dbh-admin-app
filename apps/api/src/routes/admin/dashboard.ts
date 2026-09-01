import { Hono } from 'hono';
import { and, count, eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';

export const dashboard = new Hono();

/**
 * Counted live, not read from a rollup.
 *
 * `platform_metrics_daily` used to answer this, computed nightly by a job.
 * Against three organisations and a few hundred members these counts are
 * milliseconds, and a number that is correct now beats one that was correct at
 * 01:00 — the rollup earns its place again when the estate is large enough to
 * feel it, and it comes back with the Usage screen that needs history.
 */
dashboard.get('/', async (c) => {
  const [orgs] = await db.select({ n: count() }).from(s.organizations);
  const [suspendedOrgs] = await db.select({ n: count() }).from(s.organizations)
    .where(eq(s.organizations.status, 'suspended'));

  const [activeUsers] = await db.select({ n: count() }).from(s.orgUsers)
    .where(eq(s.orgUsers.status, 'active'));
  // The number that means "somebody is blocked right now".
  const [pendingUsers] = await db.select({ n: count() }).from(s.orgUsers)
    .where(eq(s.orgUsers.status, 'pending'));
  const [activeDevices] = await db.select({ n: count() }).from(s.devices)
    .where(eq(s.devices.status, 'active'));

  const byMode = await db.select({ mode: s.licenses.mode, n: count() })
    .from(s.licenses)
    .where(eq(s.licenses.status, 'active'))
    .groupBy(s.licenses.mode);

  const [expiringSoon] = await db.select({ n: count() }).from(s.licenses)
    .where(and(
      eq(s.licenses.status, 'active'),
      sql`${s.licenses.endDate} <= CURRENT_DATE + 30`,
    ));
  const [expired] = await db.select({ n: count() }).from(s.licenses)
    .where(eq(s.licenses.status, 'expired'));

  const [pendingRequests] = await db.select({ n: count() }).from(s.accessRequests)
    .where(eq(s.accessRequests.status, 'pending'));

  // Organisations where a role is over its seat count. This is the roll-up of
  // the seat rules, and the one dashboard row an operator can act on.
  const overCap = await db.execute(sql`
    SELECT o.id, o.name,
           r.name AS role_name,
           lr.seats::int AS seats,
           count(u.id)::int AS used
    FROM organizations o
    JOIN licenses l   ON l.org_id = o.id AND l.status = 'active'
    JOIN license_roles lr ON lr.license_id = l.id
    JOIN roles r      ON r.key = lr.role_key
    LEFT JOIN org_users u ON u.org_id = o.id AND u.role_key = lr.role_key AND u.status = 'active'
    GROUP BY o.id, o.name, r.name, lr.seats
    HAVING count(u.id) > lr.seats
    ORDER BY o.name
  `);

  return c.json({
    orgs: {
      total: orgs?.n ?? 0,
      suspended: suspendedOrgs?.n ?? 0,
    },
    people: {
      active: activeUsers?.n ?? 0,
      pending: pendingUsers?.n ?? 0,
    },
    devices: { active: activeDevices?.n ?? 0 },
    licenses: {
      byMode: Object.fromEntries(byMode.map((r) => [r.mode, r.n])),
      expiringSoon: expiringSoon?.n ?? 0,
      expired: expired?.n ?? 0,
    },
    pendingRequests: pendingRequests?.n ?? 0,
    overCap: overCap.rows,
  });
});
