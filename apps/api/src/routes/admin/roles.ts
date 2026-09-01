import { Hono } from 'hono';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { createRoleSchema, patchRoleSchema } from '@app/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requiredParam } from '../../lib/params';
import { audit } from '../../middleware/audit';
import { requireCapability } from '../../middleware/auth';

export const roles = new Hono();

/**
 * Every scope must be a slug the add-in could actually understand, i.e. one
 * that exists in the catalog. Inactive catalog rows are still grantable — the
 * same reasoning as licences had: a slug must be assignable before every
 * workstation has the DLL that renders it.
 */
async function assertScopes(scopes: string[]): Promise<void> {
  if (!scopes.length) return;
  const catalog = await db.select({ slug: s.panelDefinitions.slug })
    .from(s.panelDefinitions)
    .where(inArray(s.panelDefinitions.slug, scopes));
  const known = new Set(catalog.map((p) => p.slug));
  const unknown = scopes.filter((x) => !known.has(x));
  if (unknown.length) {
    throw badRequest(`Unknown scopes: ${unknown.join(', ')}`);
  }
}

roles.get('/', async (c) => {
  const rows = await db.select().from(s.roles).orderBy(asc(s.roles.sortOrder));

  // Members per role, across every organisation. The Roles screen uses it to
  // say what deactivating one would affect, and it is the same count the seat
  // rules are built on.
  const usage = await db
    .select({ roleKey: s.orgUsers.roleKey, n: count() })
    .from(s.orgUsers)
    .where(eq(s.orgUsers.status, 'active'))
    .groupBy(s.orgUsers.roleKey);
  const byKey = new Map(usage.map((u) => [u.roleKey, u.n]));

  return c.json({ rows: rows.map((r) => ({ ...r, activeMembers: byKey.get(r.key) ?? 0 })) });
});

roles.post('/', requireCapability('role.manage'), async (c) => {
  const body = createRoleSchema.parse(await c.req.json());
  await assertScopes(body.scopes);

  try {
    const [row] = await db.insert(s.roles).values(body).returning();
    await audit(c, { action: 'role.create', targetType: 'role', after: row });
    return c.json({ row }, 201);
  } catch (e: unknown) {
    const text = String(e);
    if (text.includes('roles_name_unique') || text.includes('roles_name_key')) {
      throw conflict(`A role named "${body.name}" already exists.`);
    }
    if (text.includes('unique') || text.includes('duplicate')) {
      throw conflict(
        `The key "${body.key}" is taken. Keys are permanent — every member row and token references them — so they are never reused.`,
      );
    }
    throw e;
  }
});

/**
 * `key` cannot be patched: it is absent from `patchRoleSchema` entirely.
 *
 * That is the mechanism behind "renaming a role is safe". `name` is free to
 * change and every screen picks it up on the next render, because nothing
 * stores the name — `org_users.role_key`, `license_roles.role_key` and the
 * add-in token all carry the key, and the key never moves.
 */
roles.patch('/:key', requireCapability('role.manage'), async (c) => {
  const key = requiredParam(c, 'key');
  const body = patchRoleSchema.parse(await c.req.json());
  if (body.scopes) await assertScopes(body.scopes);

  const [before] = await db.select().from(s.roles).where(eq(s.roles.key, key)).limit(1);
  if (!before) throw notFound();

  // Deactivating the role new members are provisioned into would leave
  // auto-provisioning with nothing to assign, and every first sign-in would
  // land in the approval queue with no explanation on this screen.
  if (before.isDefault && body.isActive === false) {
    throw badRequest(
      'This is the default role for new members. Make another role the default first.',
    );
  }
  if (before.isDefault && body.isDefault === false) {
    throw badRequest('Make another role the default instead of clearing this one.');
  }

  const row = await db.transaction(async (tx) => {
    // Exactly one default. Enforced by a partial unique index too, but doing it
    // here turns a constraint violation into an intended reassignment.
    if (body.isDefault === true) {
      await tx.update(s.roles)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(s.roles.isDefault, true), ne(s.roles.key, key)));
    }
    const [updated] = await tx.update(s.roles)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(s.roles.key, key))
      .returning();
    return updated;
  });

  await audit(c, { action: 'role.update', targetType: 'role', before, after: row });
  return c.json({ row });
});
