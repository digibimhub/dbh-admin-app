import { Hono } from 'hono';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import {
  createLicenseSchema, patchLicenseSchema, extendLicenseSchema,
  licenseStatus, reasonSchema, type LicenseMode,
} from '@app/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { uuidParam } from '../../lib/params';
import { requireStepUp } from '../../middleware/auth';
import { audit } from '../../middleware/audit';
import type { DbConn } from '../../lib/db';

export const licenses = new Hono();

const today = () => new Date().toISOString().slice(0, 10);

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Every seat row must name a role that exists and is assignable. */
async function assertRoles(conn: DbConn, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const unique = [...new Set(keys)];
  if (unique.length !== keys.length) throw badRequest('One role appears twice in the seat list');

  const known = await conn.select({ key: s.roles.key, isActive: s.roles.isActive })
    .from(s.roles).where(inArray(s.roles.key, unique));
  const found = new Map(known.map((r) => [r.key, r.isActive]));

  const missing = unique.filter((k) => !found.has(k));
  if (missing.length) throw badRequest(`Unknown roles: ${missing.join(', ')}`);

  const retired = unique.filter((k) => found.get(k) === false);
  if (retired.length) {
    throw badRequest(`These roles are retired and cannot be given seats: ${retired.join(', ')}`);
  }
}

/** Seats with live occupancy, which is what the Licence tab renders. */
async function seatsFor(conn: DbConn, licenseId: string, orgId: string) {
  const rows = await conn
    .select({
      roleKey: s.licenseRoles.roleKey,
      seats: s.licenseRoles.seats,
      scopes: s.licenseRoles.scopes,
      name: s.roles.name,
      sortOrder: s.roles.sortOrder,
    })
    .from(s.licenseRoles)
    .innerJoin(s.roles, eq(s.roles.key, s.licenseRoles.roleKey))
    .where(eq(s.licenseRoles.licenseId, licenseId))
    .orderBy(asc(s.roles.sortOrder));

  const occupancy = await conn
    .select({ roleKey: s.orgUsers.roleKey, n: count() })
    .from(s.orgUsers)
    .where(and(eq(s.orgUsers.orgId, orgId), eq(s.orgUsers.status, 'active')))
    .groupBy(s.orgUsers.roleKey);
  const used = new Map(occupancy.map((o) => [o.roleKey, o.n]));

  return rows.map((r) => ({ ...r, used: used.get(r.roleKey) ?? 0 }));
}

/** Replaces the whole seat set for a licence, in one transaction. */
async function writeSeats(
  conn: DbConn,
  licenseId: string,
  seats: { roleKey: string; seats: number }[],
): Promise<void> {
  await conn.delete(s.licenseRoles).where(eq(s.licenseRoles.licenseId, licenseId));
  if (seats.length) {
    await conn.insert(s.licenseRoles).values(
      seats.map((x) => ({ licenseId, roleKey: x.roleKey, seats: x.seats })),
    );
  }
}

licenses.get('/licenses', async (c) => {
  const status = licenseStatus.optional().parse(c.req.query('status') || undefined);
  const rows = await db
    .select({
      license: s.licenses,
      orgName: s.organizations.name,
      orgSlug: s.organizations.slug,
    })
    .from(s.licenses)
    .innerJoin(s.organizations, eq(s.organizations.id, s.licenses.orgId))
    .where(status ? eq(s.licenses.status, status) : undefined)
    .orderBy(asc(s.licenses.endDate));
  return c.json({ rows });
});

licenses.get('/orgs/:id/license', async (c) => {
  const id = uuidParam(c);
  const [license] = await db.select().from(s.licenses)
    .where(and(eq(s.licenses.orgId, id), eq(s.licenses.status, 'active'))).limit(1);

  if (!license) return c.json({ license: null, seats: [], events: [] });

  const seats = await seatsFor(db, license.id, id);
  const events = await db.select().from(s.licenseEvents)
    .where(eq(s.licenseEvents.licenseId, license.id))
    .orderBy(desc(s.licenseEvents.createdAt))
    .limit(20);

  return c.json({ license, seats, events });
});

licenses.post('/orgs/:id/license', async (c) => {
  const id = uuidParam(c);
  const body = createLicenseSchema.parse(await c.req.json());
  const user = c.get('portalUser');

  if (body.endDate < body.startDate) throw badRequest('End date is before the start date');
  await assertRoles(db, body.seats.map((x) => x.roleKey));

  const [org] = await db.select().from(s.organizations)
    .where(eq(s.organizations.id, id)).limit(1);
  if (!org) throw notFound('Organisation not found');

  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(s.licenses).values({
        orgId: id,
        mode: body.mode,
        startDate: body.startDate,
        endDate: body.endDate,
        graceDays: body.graceDays,
        createdBy: user.id,
      }).returning();

      await writeSeats(tx, created!.id, body.seats);
      await tx.insert(s.licenseEvents).values({
        licenseId: created!.id,
        eventType: 'created',
        newEndDate: body.endDate,
        newStatus: 'active',
        reason: `issued as ${body.mode}`,
        actorId: user.id,
      });
      return created;
    });

    await audit(c, {
      orgId: id, action: 'license.create', targetType: 'license',
      targetId: row!.id, after: { ...row, seats: body.seats },
    });
    return c.json({ row }, 201);
  } catch (e: unknown) {
    if (String(e).includes('uniq_active_license_per_org')) {
      throw conflict('This organisation already has an active licence. Suspend it before issuing another.');
    }
    throw e;
  }
});

licenses.patch('/licenses/:id', async (c) => {
  const id = uuidParam(c);
  const body = patchLicenseSchema.parse(await c.req.json());

  const [before] = await db.select().from(s.licenses).where(eq(s.licenses.id, id)).limit(1);
  if (!before) throw notFound();

  // Validate against the state the row will HAVE, not the fragment sent. A
  // patch that moves only one of the two dates was previously unchecked and
  // surfaced as a 500 from the database CHECK constraint.
  const startDate = body.startDate ?? before.startDate;
  const endDate = body.endDate ?? before.endDate;
  if (endDate < startDate) throw badRequest('End date is before the start date');

  if (body.seats) await assertRoles(db, body.seats.map((x) => x.roleKey));

  const row = await db.transaction(async (tx) => {
    const { seats, ...columns } = body;
    const [updated] = await tx.update(s.licenses)
      .set({ ...columns, updatedAt: new Date() })
      .where(eq(s.licenses.id, id))
      .returning();
    if (seats) await writeSeats(tx, id, seats);
    return updated;
  });

  await audit(c, {
    orgId: before.orgId, action: 'license.update', targetType: 'license',
    targetId: id, before, after: row,
  });
  return c.json({ row });
});

licenses.post('/licenses/:id/extend', async (c) => {
  const id = uuidParam(c);
  const body = extendLicenseSchema.parse(await c.req.json());
  const user = c.get('portalUser');

  const [before] = await db.select().from(s.licenses).where(eq(s.licenses.id, id)).limit(1);
  if (!before) throw notFound();

  // Anchor on whichever is later, so extending a lapsed licence gives a full
  // term rather than a window that is already half spent.
  const anchor = before.endDate > today() ? before.endDate : today();
  const newEnd = body.newEndDate ?? addMonths(anchor, body.months!);
  if (newEnd < before.startDate) throw badRequest('New end date is before the start date');

  const row = await db.transaction(async (tx) => {
    const nextStatus = before.status === 'expired' ? 'active' : before.status;
    const [updated] = await tx.update(s.licenses)
      .set({ endDate: newEnd, status: nextStatus, updatedAt: new Date() })
      .where(eq(s.licenses.id, id))
      .returning();

    await tx.insert(s.licenseEvents).values({
      licenseId: id,
      eventType: 'extended',
      oldEndDate: before.endDate,
      newEndDate: newEnd,
      oldStatus: before.status,
      newStatus: nextStatus,
      reason: body.reason,
      actorId: user.id,
    });
    return updated;
  });

  await audit(c, {
    orgId: before.orgId, action: 'license.extend', targetType: 'license',
    targetId: id, before, after: row,
  });
  return c.json({ row });
});

licenses.post('/licenses/:id/suspend', async (c) => {
  requireStepUp(c);
  const id = uuidParam(c);
  const { reason } = reasonSchema.parse(await c.req.json());

  const [before] = await db.select().from(s.licenses).where(eq(s.licenses.id, id)).limit(1);
  if (!before) throw notFound();

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(s.licenses)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(s.licenses.id, id))
      .returning();
    await tx.insert(s.licenseEvents).values({
      licenseId: id,
      eventType: 'suspended',
      oldStatus: before.status,
      newStatus: 'suspended',
      reason,
      actorId: c.get('portalUser').id,
    });
    return updated;
  });

  await audit(c, {
    orgId: before.orgId, action: 'license.suspend', targetType: 'license',
    targetId: id, before, after: row,
  });
  return c.json({ row });
});

/**
 * The counterpart to suspend, which did not exist.
 *
 * `status` is not patchable, and extend only revives an `expired` licence — so
 * a suspended one had no route back to active and was stuck permanently. An
 * operator who suspends a customer by mistake needs the undo more than the
 * safety of not having one.
 */
licenses.post('/licenses/:id/resume', async (c) => {
  const id = uuidParam(c);
  const { reason } = reasonSchema.parse(await c.req.json());

  const [before] = await db.select().from(s.licenses).where(eq(s.licenses.id, id)).limit(1);
  if (!before) throw notFound();
  if (before.status !== 'suspended') {
    throw badRequest(`This licence is ${before.status}, not suspended.`);
  }

  // A licence suspended past its end date comes back expired, not active —
  // resuming must not silently extend a term nobody paid for.
  const nextStatus = before.endDate < today() ? 'expired' : 'active';

  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(s.licenses)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(s.licenses.id, id))
        .returning();
      await tx.insert(s.licenseEvents).values({
        licenseId: id,
        eventType: 'resumed',
        oldStatus: 'suspended',
        newStatus: nextStatus,
        reason,
        actorId: c.get('portalUser').id,
      });
      return updated;
    });

    await audit(c, {
      orgId: before.orgId, action: 'license.resume', targetType: 'license',
      targetId: id, before, after: row,
    });
    return c.json({ row });
  } catch (e: unknown) {
    if (String(e).includes('uniq_active_license_per_org')) {
      throw conflict('Another licence became active for this organisation while this one was suspended.');
    }
    throw e;
  }
});

licenses.get('/licenses/:id/events', async (c) => {
  const id = uuidParam(c);
  const rows = await db
    .select({ event: s.licenseEvents, actorEmail: s.portalUsers.email })
    .from(s.licenseEvents)
    .leftJoin(s.portalUsers, eq(s.portalUsers.id, s.licenseEvents.actorId))
    .where(eq(s.licenseEvents.licenseId, id))
    .orderBy(desc(s.licenseEvents.createdAt))
    .limit(50);
  return c.json({ rows });
});

export type { LicenseMode };
