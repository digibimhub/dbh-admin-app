import { Hono } from 'hono';
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { sha256Hex } from '@app/core';
import {
  createUserSchema, patchUserSchema, reasonSchema,
  setMemberRoleSchema, userQuerySchema,
} from '@app/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import {
  importCommitSchema, importPreviewSchema, type ImportPlanRow,
} from '../../lib/validation';
import { parseCsv, toObject } from '../../lib/csv';
import { uuidParam } from '../../lib/params';
import { audit } from '../../middleware/audit';
import { env } from '../../env';
import { requireCapability } from '../../middleware/auth';
import {
  assertRoleAssignable, assertSeatAvailable, defaultRoleKey, seatUsage,
} from '../../lib/seats';

export const users = new Hono();


/* ------------------------------------------------------------------ list */

users.get('/', async (c) => {
  const q = userQuerySchema.parse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    q: c.req.query('q'),
    org: c.req.query('org') || undefined,
    role: c.req.query('role') || undefined,
    status: c.req.query('status') || undefined,
    source: c.req.query('source') || undefined,
  });

  const filters = [];
  if (q.org) filters.push(eq(s.orgUsers.orgId, q.org));
  if (q.role) filters.push(eq(s.orgUsers.roleKey, q.role));
  if (q.status) filters.push(eq(s.orgUsers.status, q.status));
  if (q.source) filters.push(eq(s.orgUsers.source, q.source));
  if (q.q) filters.push(or(ilike(s.orgUsers.email, `%${q.q}%`), ilike(s.orgUsers.displayName, `%${q.q}%`)));
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db.select({
    user: s.orgUsers,
    orgName: s.organizations.name,
    orgSlug: s.organizations.slug,
    roleName: s.roles.name,
  }).from(s.orgUsers)
    .innerJoin(s.organizations, eq(s.organizations.id, s.orgUsers.orgId))
    .innerJoin(s.roles, eq(s.roles.key, s.orgUsers.roleKey))
    .where(where)
    // Pending first: somebody waiting on a seat is the row an operator opened
    // this screen to act on, and sorting them under 200 active people hides it.
    .orderBy(sql`CASE WHEN ${s.orgUsers.status} = 'pending' THEN 0 ELSE 1 END`,
      desc(s.orgUsers.lastActivityAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  const [total] = await db.select({ n: count() }).from(s.orgUsers).where(where);
  return c.json({ rows, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
});

users.post('/', requireCapability('user.manage'), async (c) => {
  const body = createUserSchema.parse(await c.req.json());
  const actor = c.get('portalUser');
  const roleKey = body.roleKey ?? await defaultRoleKey(db);

  // autodesk_id and email are both globally unique: one person, one org.
  // Catch it here so the operator gets a usable message instead of a 500.
  const [clash] = await db.select().from(s.orgUsers)
    .where(or(
      eq(s.orgUsers.email, body.email),
      body.autodeskId ? eq(s.orgUsers.autodeskId, body.autodeskId) : sql`false`,
    ))
    .limit(1);
  if (clash) {
    throw conflict(clash.orgId === body.orgId
      ? 'This person is already a member of that organisation'
      : 'This person already belongs to another organisation.');
  }

  await assertRoleAssignable(db, roleKey);
  await assertSeatAvailable(db, body.orgId, roleKey);

  const [row] = await db.insert(s.orgUsers).values({
    orgId: body.orgId,
    email: body.email,
    autodeskId: body.autodeskId,
    displayName: body.displayName,
    roleKey,
    source: 'manual',
    createdBy: actor.id,
  }).returning();

  await audit(c, {
    orgId: body.orgId,
    action: 'user.create',
    targetType: 'org_user',
    targetId: row!.id,
    after: row,
  });
  return c.json({ row }, 201);
});

/* ------------------------------------------------------------- CSV import */

const IMPORT_HELP = 'Expected a header row with at least: email. Optional: display_name, role.';

interface PlannedImport {
  rows: ImportPlanRow[];
  summary: Record<string, number>;
  /** Rows that will ask for a seat when committed, by role key. */
  demand: Record<string, number>;
}

/**
 * The preview is stateless: there is no table to park a pending diff in, so
 * the plan travels back to the client and returns with this token. The token
 * is keyed on the portal secret, so a hand-edited plan cannot be committed —
 * the client can only apply exactly what it was shown.
 */
function planToken(orgId: string, rows: ImportPlanRow[]): string {
  const canonical = JSON.stringify(rows.map((r) => [r.line, r.action, r.email, r.roleKey ?? '', r.displayName ?? '', r.existingUserId ?? '']));
  return sha256Hex(`${env.jwtPortalSecret}:${orgId}:${canonical}`);
}

async function planImport(orgId: string, csv: string): Promise<PlannedImport> {
  const table = parseCsv(csv);
  if (!table.header.includes('email')) throw badRequest(`CSV has no "email" column. ${IMPORT_HELP}`);
  if (!table.rows.length) throw badRequest('CSV has no data rows');
  if (table.rows.length > 5000) throw badRequest('CSV has more than 5000 rows; split the file');

  // Roles are data now, so the accepted values come from the table rather than
  // an enum. Both the key and the display name are accepted, because an
  // operator exporting a member list gets names, not keys.
  const roleRows = await db.select().from(s.roles);
  const byKey = new Map(roleRows.map((r) => [r.key.toLowerCase(), r]));
  const byName = new Map(roleRows.map((r) => [r.name.toLowerCase(), r]));
  const fallback = roleRows.find((r) => r.isDefault);
  if (!fallback) throw badRequest('No default role is configured. Set one in Settings → Roles.');

  const parsed = table.rows.map((r) => ({ line: r.line, obj: toObject(table.header, r.values) }));
  const emails = [...new Set(parsed.map((p) => p.obj.email?.toLowerCase()).filter((e): e is string => Boolean(e)))];

  // One query for the whole file. Row-by-row lookups would make a 5000-line
  // import 5000 round trips.
  const existing = emails.length
    ? await db.select().from(s.orgUsers).where(inArray(s.orgUsers.email, emails))
    : [];
  const byEmail = new Map(existing.map((u) => [u.email?.toLowerCase() ?? '', u]));

  const seen = new Set<string>();
  const rows: ImportPlanRow[] = [];
  // Counted with the same rule the commit applies, so this forecast and the
  // gate that runs later cannot disagree about who needs a seat.
  const demand = new Map<string, number>();
  const want = (key: string) => demand.set(key, (demand.get(key) ?? 0) + 1);

  for (const { line, obj } of parsed) {
    const email = (obj.email ?? '').toLowerCase();
    const displayName = obj.display_name || undefined;
    const roleRaw = (obj.role || '').trim().toLowerCase();

    if (!email || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      rows.push({ line, action: 'invalid', email: obj.email ?? '', message: 'Not a valid email address' });
      continue;
    }
    if (seen.has(email)) {
      rows.push({ line, action: 'invalid', email, message: 'Duplicate of an earlier row in this file' });
      continue;
    }
    seen.add(email);

    const role = roleRaw ? (byKey.get(roleRaw) ?? byName.get(roleRaw)) : fallback;
    if (!role) {
      const known = roleRows.map((r) => r.name).join(', ');
      rows.push({ line, action: 'invalid', email, message: `Unknown role "${roleRaw}" (expected one of: ${known})` });
      continue;
    }
    if (!role.isActive) {
      rows.push({ line, action: 'invalid', email, message: `"${role.name}" is retired and cannot be assigned` });
      continue;
    }

    const current = byEmail.get(email);
    if (!current) {
      want(role.key);
      rows.push({ line, action: 'create', email, displayName: displayName ?? null, roleKey: role.key });
      continue;
    }
    if (current.orgId !== orgId) {
      // org_users.email is globally unique and one person belongs to one org.
      // Silently reassigning them here would move a paying seat between
      // customers; that has to be an explicit transfer.
      rows.push({
        line, action: 'conflict', email, existingUserId: current.id,
        message: 'Already a member of another organisation',
      });
      continue;
    }

    const changingRole = current.roleKey !== role.key;
    if (changingRole && current.status === 'active') want(role.key);

    const changes = changingRole
      || (displayName !== undefined && current.displayName !== displayName);
    rows.push({
      line,
      action: changes ? 'update' : 'unchanged',
      email,
      displayName: displayName ?? current.displayName,
      roleKey: role.key,
      existingUserId: current.id,
    });
  }

  const summary: Record<string, number> = { create: 0, update: 0, unchanged: 0, conflict: 0, invalid: 0 };
  for (const r of rows) summary[r.action] = (summary[r.action] ?? 0) + 1;
  return { rows, summary, demand: Object.fromEntries(demand) };
}

/** POST /admin/users/import/preview — CSV to diff. Writes nothing. */
users.post('/import/preview', requireCapability('user.import'), async (c) => {
  const body = importPreviewSchema.parse(await c.req.json());
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, body.orgId)).limit(1);
  if (!org) throw notFound('Organisation not found');

  const plan = await planImport(body.orgId, body.csv);

  await audit(c, {
    orgId: body.orgId,
    action: 'user.import_preview',
    targetType: 'organization',
    targetId: body.orgId,
    after: plan.summary,
  });

  /*
    What the plan will ask of the licence, per role.

    The preview used to say nothing about seats, so an operator could approve
    50 rows into 10 free seats and only learn about it from a "10 created"
    afterwards. It stays a forecast: nothing is reserved between here and the
    commit, so a race can still move the numbers.
  */
  const usage = await seatUsage(db, body.orgId);
  const seatForecast = Object.entries(plan.demand).map(([key, wanted]) => {
    const u = usage.get(key) ?? { roleName: key, seats: 0, used: 0 };
    const free = Math.max(0, u.seats - u.used);
    return {
      roleKey: key,
      roleName: u.roleName,
      seats: u.seats,
      used: u.used,
      free,
      wanted,
      shortfall: Math.max(0, wanted - free),
    };
  });

  return c.json({
    orgId: body.orgId,
    token: planToken(body.orgId, plan.rows),
    summary: plan.summary,
    rows: plan.rows,
    seatForecast,
  });
});

/** POST /admin/users/import/commit — applies a previewed diff. */
users.post('/import/commit', requireCapability('user.import'), async (c) => {
  const body = importCommitSchema.parse(await c.req.json());
  const actor = c.get('portalUser');

  if (planToken(body.orgId, body.rows) !== body.token) {
    throw badRequest('This plan does not match its preview. Re-run the preview and commit that result.');
  }

  const applied = body.rows.filter((r) => r.action === 'create' || r.action === 'update');
  if (!applied.length) return c.json({ created: 0, updated: 0, skippedNoSeat: 0, rows: [] });

  const fallbackRole = await defaultRoleKey(db);

  const result = await db.transaction(async (tx) => {
    const created: string[] = [];
    const updated: string[] = [];
    const skipped: { email: string; reason: string }[] = [];

    // Current role and status of every member the plan means to update, so the
    // seat rule below can match the one `PATCH /:id` follows.
    const ids = applied.map((r) => r.existingUserId).filter((v): v is string => Boolean(v));
    const currentById = new Map(
      (ids.length
        ? await tx.select({ id: s.orgUsers.id, roleKey: s.orgUsers.roleKey, status: s.orgUsers.status })
          .from(s.orgUsers).where(inArray(s.orgUsers.id, ids))
        : []
      ).map((u) => [u.id, u]),
    );

    for (const row of applied) {
      const roleKey = row.roleKey ?? fallbackRole;
      const current = row.existingUserId ? currentById.get(row.existingUserId) : undefined;
      const changingRole = current !== undefined && current.roleKey !== roleKey;

      // A create always takes a seat. An update takes one only when it moves an
      // ACTIVE member into a different role — correcting a spelling on somebody
      // already in a full role consumes nothing and must not be refused. The
      // check stays inside the transaction, so each row counts the rows before
      // it and an import past the seat count fills what it can rather than
      // failing whole or silently over-filling.
      if (row.action === 'create' || (changingRole && current!.status === 'active')) {
        try {
          await assertSeatAvailable(tx, body.orgId, roleKey, row.existingUserId ?? undefined);
        } catch (e: unknown) {
          skipped.push({ email: row.email, reason: e instanceof Error ? e.message : 'no free seat' });
          continue;
        }
      }

      if (row.action === 'create') {
        const [inserted] = await tx.insert(s.orgUsers).values({
          orgId: body.orgId,
          email: row.email,
          displayName: row.displayName ?? undefined,
          roleKey,
          source: 'import',
          createdBy: actor.id,
        }).returning({ id: s.orgUsers.id });
        created.push(inserted!.id);
      } else if (row.existingUserId) {
        const [changed] = await tx.update(s.orgUsers).set({
          displayName: row.displayName ?? undefined,
          roleKey,
          updatedAt: new Date(),
        })
          // Scoped to the org so a tampered existingUserId cannot reach a
          // row belonging to another customer.
          .where(and(eq(s.orgUsers.id, row.existingUserId), eq(s.orgUsers.orgId, body.orgId)))
          .returning({ id: s.orgUsers.id });
        if (changed) updated.push(changed.id);
      }
    }
    return { created, updated, skipped };
  });

  await audit(c, {
    orgId: body.orgId,
    action: 'user.import_commit',
    targetType: 'organization',
    targetId: body.orgId,
    before: {
      plannedCreates: applied.filter((r) => r.action === 'create').length,
      plannedUpdates: applied.filter((r) => r.action === 'update').length,
    },
    after: {
      created: result.created.length,
      updated: result.updated.length,
      skippedNoSeat: result.skipped.length,
      // The emails too, not just a count: a person the import refused a seat
      // is otherwise recorded nowhere durable.
      skippedEmails: result.skipped.map((r) => r.email),
      createdIds: result.created,
      updatedIds: result.updated,
    },
  });

  return c.json({
    created: result.created.length,
    updated: result.updated.length,
    skippedNoSeat: result.skipped.length,
    skipped: result.skipped,
  });
});

/* ------------------------------------------------------------- single user */

users.get('/:id', async (c) => {
  const id = uuidParam(c);
  const [row] = await db.select({
    user: s.orgUsers,
    orgName: s.organizations.name,
    roleName: s.roles.name,
  }).from(s.orgUsers)
    .innerJoin(s.organizations, eq(s.organizations.id, s.orgUsers.orgId))
    .innerJoin(s.roles, eq(s.roles.key, s.orgUsers.roleKey))
    .where(eq(s.orgUsers.id, id)).limit(1);
  if (!row) throw notFound();

  const devices = await db.select().from(s.devices)
    .where(eq(s.devices.orgUserId, id))
    .orderBy(desc(s.devices.lastSeenAt));
  return c.json({ ...row, devices });
});

/** GET /admin/users/:id/devices — every workstation this person has used. */
users.get('/:id/devices', async (c) => {
  const id = uuidParam(c);
  const [user] = await db.select().from(s.orgUsers).where(eq(s.orgUsers.id, id)).limit(1);
  if (!user) throw notFound();

  const rows = await db.select({
    device: s.devices,
    lastUsage: sql<string | null>`(
      SELECT max(usage_date)::text FROM usage_daily u
      WHERE u.device_id = ${s.devices.id} AND u.org_user_id = ${id}
    )`,
  }).from(s.devices)
    .where(eq(s.devices.orgUserId, id))
    .orderBy(desc(s.devices.lastSeenAt));

  return c.json({ rows, total: rows.length });
});

users.patch('/:id', requireCapability('user.manage'), async (c) => {
  const id = uuidParam(c);
  const body = patchUserSchema.parse(await c.req.json());
  const [before] = await db.select().from(s.orgUsers).where(eq(s.orgUsers.id, id)).limit(1);
  if (!before) throw notFound();

  const roleKey = body.roleKey ?? before.roleKey;
  const becomingActive = body.status === 'active' && before.status !== 'active';
  const changingRole = body.roleKey !== undefined && body.roleKey !== before.roleKey;

  if (changingRole) await assertRoleAssignable(db, roleKey);
  // Only a transition INTO an occupied state consumes a seat. Editing a
  // display name on a member of a full role must not fail.
  if (becomingActive || (changingRole && before.status === 'active')) {
    await assertSeatAvailable(db, before.orgId, roleKey, id);
  }

  const [row] = await db.update(s.orgUsers)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(s.orgUsers.id, id))
    .returning();

  await audit(c, {
    orgId: before.orgId,
    action: 'user.update',
    targetType: 'org_user',
    targetId: id,
    before,
    after: row,
  });
  return c.json({ row });
});

/**
 * POST /admin/users/:id/role
 *
 * Kept separate from PATCH so the audit trail records a role change as its
 * own action — "who made this person an admin" is the first question asked
 * after an incident, and it should not be buried in a generic update.
 *
 * The move frees the old role's seat and takes one in the new role in this
 * single statement, because occupancy is counted rather than stored.
 */
users.post('/:id/role', requireCapability('user.manage'), async (c) => {
  const id = uuidParam(c);
  const body = setMemberRoleSchema.parse(await c.req.json());
  const [before] = await db.select().from(s.orgUsers).where(eq(s.orgUsers.id, id)).limit(1);
  if (!before) throw notFound();

  await assertRoleAssignable(db, body.roleKey);
  if (before.status === 'active' && body.roleKey !== before.roleKey) {
    await assertSeatAvailable(db, before.orgId, body.roleKey, id);
  }

  const [row] = await db.update(s.orgUsers)
    .set({ roleKey: body.roleKey, updatedAt: new Date() })
    .where(eq(s.orgUsers.id, id))
    .returning();

  await audit(c, {
    orgId: before.orgId,
    action: 'user.role_change',
    targetType: 'org_user',
    targetId: id,
    before: { roleKey: before.roleKey },
    // The new role — and the scopes that come with it — reach the workstation
    // at the next /v1/token/refresh, without a re-login.
    after: { roleKey: row!.roleKey },
  });
  return c.json({ row });
});

/**
 * POST /admin/users/:id/approve — give a waiting person a seat.
 *
 * The counterpart to `seats_exhausted`. Optionally moves them to a different
 * role at the same time, which is how an operator resolves "the User seats are
 * full but there is room in Coordinator".
 */
users.post('/:id/approve', requireCapability('user.manage'), async (c) => {
  const id = uuidParam(c);
  const body = setMemberRoleSchema.partial().parse(await c.req.json().catch(() => ({})));

  const [before] = await db.select().from(s.orgUsers).where(eq(s.orgUsers.id, id)).limit(1);
  if (!before) throw notFound();
  if (before.status !== 'pending') {
    throw badRequest(`This person is ${before.status}, not waiting for a seat.`);
  }

  const roleKey = body.roleKey ?? before.roleKey;
  await assertRoleAssignable(db, roleKey);
  await assertSeatAvailable(db, before.orgId, roleKey, id);

  const [row] = await db.update(s.orgUsers)
    .set({ status: 'active', roleKey, updatedAt: new Date() })
    .where(eq(s.orgUsers.id, id))
    .returning();

  await audit(c, {
    orgId: before.orgId,
    action: 'user.approve',
    targetType: 'org_user',
    targetId: id,
    before,
    // Their existing session is untouched, so the next check succeeds with no
    // sign-in — which is the whole point of holding them as a member.
    after: row,
  });
  return c.json({ row });
});

users.post('/:id/disable', requireCapability('user.manage'), async (c) => {
  const id = uuidParam(c);
  // A reason is required: it lands in audit_log, and a disable with no
  // recorded reason is the row nobody can explain six months later.
  const { reason } = reasonSchema.parse(await c.req.json());

  const [before] = await db.select().from(s.orgUsers).where(eq(s.orgUsers.id, id)).limit(1);
  if (!before) throw notFound();

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(s.orgUsers).set({
      status: 'disabled',
      updatedAt: new Date(),
    }).where(eq(s.orgUsers.id, id)).returning();

    // Kill the refresh tokens too. resolveUser would deny at the next
    // heartbeat anyway, but leaving live sessions on a disabled account
    // means their current access token keeps working until it expires.
    await tx.update(s.addinSessions)
      .set({ revokedAt: new Date(), revokedReason: 'user disabled' })
      .where(and(eq(s.addinSessions.orgUserId, id), sql`revoked_at IS NULL`));

    return updated!;
  });

  await audit(c, {
    orgId: before.orgId,
    action: 'user.disable',
    targetType: 'org_user',
    targetId: id,
    before,
    after: { ...row, reason },
  });
  return c.json({ row });
});

/**
 * Re-enabling consumes a seat, so it can fail where disabling never does. The
 * seat they vacated may well have been taken while they were disabled.
 */
users.post('/:id/enable', requireCapability('user.manage'), async (c) => {
  const id = uuidParam(c);
  const [before] = await db.select().from(s.orgUsers).where(eq(s.orgUsers.id, id)).limit(1);
  if (!before) throw notFound();

  await assertRoleAssignable(db, before.roleKey);
  await assertSeatAvailable(db, before.orgId, before.roleKey, id);

  const [row] = await db.update(s.orgUsers).set({
    status: 'active',
    updatedAt: new Date(),
  }).where(eq(s.orgUsers.id, id)).returning();

  await audit(c, {
    orgId: before.orgId,
    action: 'user.enable',
    targetType: 'org_user',
    targetId: id,
    before,
    after: row,
  });
  return c.json({ row });
});

