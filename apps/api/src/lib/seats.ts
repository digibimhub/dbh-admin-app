import { and, count, eq, ne } from 'drizzle-orm';
import { schema as s } from '@app/db';
import { badRequest, conflict } from './errors';
import type { DbConn } from './db';

/**
 * Seat rules, in one place because three routes enforce them: creating a
 * member, changing their role, and approving one who was waiting.
 *
 * Occupancy is always a COUNT of active members in a role, never a stored
 * tally. That is the whole design: moving somebody from `user` to `admin`
 * frees a user seat and takes an admin seat in the single statement that
 * changes `role_key`, with nothing to keep in step and nothing to drift.
 */

/** A role must exist and be assignable before anybody is put in it. */
export async function assertRoleAssignable(conn: DbConn, roleKey: string): Promise<void> {
  const [role] = await conn.select().from(s.roles).where(eq(s.roles.key, roleKey)).limit(1);
  if (!role) throw badRequest(`Unknown role "${roleKey}"`);
  if (!role.isActive) {
    throw badRequest(`"${role.name}" is retired and cannot be assigned to anybody new.`);
  }
}

export async function defaultRoleKey(conn: DbConn): Promise<string> {
  const [role] = await conn.select({ key: s.roles.key }).from(s.roles)
    .where(eq(s.roles.isDefault, true)).limit(1);
  if (!role) throw badRequest('No default role is configured. Set one in Settings → Roles.');
  return role.key;
}

/**
 * Refuse to make another person active in a role whose seats are full.
 *
 * `excludeUserId` covers the person being moved: somebody already active in
 * the target role must not be counted as a new occupant when their row is
 * re-saved.
 *
 * This gates BECOMING active in a role. It never revisits a grant already
 * made, so lowering the seat count below current occupancy is allowed and
 * evicts nobody — it simply shows as over-cap until people leave.
 */
export async function assertSeatAvailable(
  conn: DbConn,
  orgId: string,
  roleKey: string,
  excludeUserId?: string,
): Promise<void> {
  const [license] = await conn.select({ id: s.licenses.id }).from(s.licenses)
    .where(and(eq(s.licenses.orgId, orgId), eq(s.licenses.status, 'active'))).limit(1);
  if (!license) {
    throw conflict('This organisation has no active licence, so it has no seats to assign.');
  }

  const [seat] = await conn.select({ seats: s.licenseRoles.seats }).from(s.licenseRoles)
    .where(and(
      eq(s.licenseRoles.licenseId, license.id),
      eq(s.licenseRoles.roleKey, roleKey),
    )).limit(1);
  // No seat row means zero seats, not unlimited. A role a licence never
  // bought is a role nobody can hold.
  const total = seat?.seats ?? 0;

  const [used] = await conn.select({ n: count() }).from(s.orgUsers)
    .where(and(
      eq(s.orgUsers.orgId, orgId),
      eq(s.orgUsers.roleKey, roleKey),
      eq(s.orgUsers.status, 'active'),
      excludeUserId ? ne(s.orgUsers.id, excludeUserId) : undefined,
    ));

  if ((used?.n ?? 0) >= total) {
    const [role] = await conn.select({ name: s.roles.name }).from(s.roles)
      .where(eq(s.roles.key, roleKey)).limit(1);
    throw conflict(
      `No free ${role?.name ?? roleKey} seat: ${used?.n ?? 0} of ${total} in use. Raise the count on the Licence tab or free a seat first.`,
    );
  }
}
