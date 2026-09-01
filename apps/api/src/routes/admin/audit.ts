import { Hono } from 'hono';
import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { auditQuerySchema } from '@app/shared';

export const audit = new Hono();

/** A bare date means the whole day, so `to=2026-08-28` includes that day. */
function boundary(value: string, endOfDay: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  }
  return new Date(value);
}

/**
 * GET /admin/audit-log?org=&actor=&action=&from=&to=&page=&pageSize=
 *
 * Every filter is applied in SQL. The previous version fetched the newest 100
 * rows and then filtered them in JavaScript, so searching for an action that
 * had not happened in the last 100 events returned nothing at all — the one
 * situation where you most need the audit log to work.
 */
audit.get('/', async (c) => {
  const q = auditQuerySchema.parse({
    org: c.req.query('org') || undefined,
    actor: c.req.query('actor') || undefined,
    action: c.req.query('action') || undefined,
    from: c.req.query('from') || undefined,
    to: c.req.query('to') || undefined,
    page: c.req.query('page') ?? undefined,
    pageSize: c.req.query('pageSize') ?? undefined,
    q: c.req.query('q') || undefined,
  });

  const filters = [];
  if (q.org) filters.push(eq(s.auditLog.orgId, q.org));
  if (q.actor) filters.push(eq(s.auditLog.actorId, q.actor));
  if (q.action) filters.push(ilike(s.auditLog.action, `%${q.action}%`));
  if (q.from) filters.push(gte(s.auditLog.createdAt, boundary(q.from, false)));
  if (q.to) filters.push(lte(s.auditLog.createdAt, boundary(q.to, true)));
  // Free-text falls back to the actor's email, which is what support has
  // when they were handed a name rather than a user id.
  if (q.q) filters.push(or(ilike(s.auditLog.actorEmail, `%${q.q}%`), ilike(s.auditLog.action, `%${q.q}%`)));
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db.select({
    entry: s.auditLog,
    orgName: s.organizations.name,
  }).from(s.auditLog)
    .leftJoin(s.organizations, eq(s.organizations.id, s.auditLog.orgId))
    .where(where)
    .orderBy(desc(s.auditLog.createdAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(s.auditLog).where(where);

  return c.json({ rows, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize });
});

/** Distinct action names, so the UI can offer a filter list instead of free text. */
audit.get('/actions', async (c) => {
  const rows = await db.selectDistinct({ action: s.auditLog.action })
    .from(s.auditLog)
    .orderBy(s.auditLog.action)
    .limit(200);
  return c.json({ rows: rows.map((r) => r.action) });
});
