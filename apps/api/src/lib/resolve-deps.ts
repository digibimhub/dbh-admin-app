import { and, count, eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import type { AutodeskIdentity, DeviceInfo, ResolveDeps, UserRow } from '@app/core';
import { emailDomain } from '@app/core';
import type { DbConn } from './db';
import { writeAudit } from '../middleware/audit';

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

type OrgUserRow = typeof s.orgUsers.$inferSelect;

function toUserRow(row: OrgUserRow): UserRow {
  return {
    id: row.id, orgId: row.orgId, roleKey: row.roleKey,
    status: row.status, pendingReason: row.pendingReason,
  };
}

/**
 * `conn` defaults to the pool but accepts a transaction, so the five steps of
 * /v1/token/refresh (verify, resolve, device, usage, sign) commit or roll back
 * together.
 */
export function dbResolveDeps(conn: DbConn = db): ResolveDeps {
  return {
    async findUserByAutodeskId(autodeskId) {
      const [row] = await conn.select().from(s.orgUsers)
        .where(eq(s.orgUsers.autodeskId, autodeskId)).limit(1);
      return row ? toUserRow(row) : null;
    },

    async findUserByEmail(email) {
      const [row] = await conn.select().from(s.orgUsers)
        .where(eq(s.orgUsers.email, email)).limit(1);
      return row ? toUserRow(row) : null;
    },

    /**
     * One row or none. `uniq_domain_global` guarantees it, which is what
     * removed the multi-org narrowing loop this function used to need.
     */
    async findOrgByEmailDomain(domain) {
      const [row] = await conn.select({ org: s.organizations }).from(s.orgDomains)
        .innerJoin(s.organizations, eq(s.organizations.id, s.orgDomains.orgId))
        .where(eq(s.orgDomains.value, domain))
        .limit(1);
      if (!row) return null;
      return { id: row.org.id, name: row.org.name, status: row.org.status, joinPolicy: row.org.joinPolicy };
    },

    async getOrg(orgId) {
      const [row] = await conn.select().from(s.organizations)
        .where(eq(s.organizations.id, orgId)).limit(1);
      if (!row) return null;
      return { id: row.id, name: row.name, status: row.status, joinPolicy: row.joinPolicy };
    },

    async getActiveLicense(orgId) {
      const [row] = await conn.select().from(s.licenses)
        .where(and(eq(s.licenses.orgId, orgId), eq(s.licenses.status, 'active'))).limit(1);
      if (!row) return null;
      return {
        id: row.id, orgId: row.orgId, mode: row.mode, status: row.status,
        startDate: row.startDate, endDate: row.endDate, graceDays: row.graceDays,
      };
    },

    async getDevice(orgId, deviceHash) {
      const [row] = await conn.select().from(s.devices)
        .where(and(eq(s.devices.orgId, orgId), eq(s.devices.deviceHash, deviceHash))).limit(1);
      if (!row) return null;
      return { id: row.id, status: row.status };
    },

    async getRole(roleKey) {
      const [row] = await conn.select().from(s.roles).where(eq(s.roles.key, roleKey)).limit(1);
      if (!row) return null;
      return {
        key: row.key, name: row.name, scopes: asStringArray(row.scopes), isActive: row.isActive,
      };
    },

    async getDefaultRole() {
      const [row] = await conn.select().from(s.roles).where(eq(s.roles.isDefault, true)).limit(1);
      if (!row) return null;
      return {
        key: row.key, name: row.name, scopes: asStringArray(row.scopes), isActive: row.isActive,
      };
    },

    /**
     * Seat occupancy, counted rather than stored.
     *
     * This is the whole seat mechanism: because occupancy is derived, moving
     * somebody between roles frees one seat and takes another in the single
     * statement that changes `role_key`, with no counter to keep in step.
     */
    async countActiveInRole(orgId, roleKey) {
      const [row] = await conn.select({ n: count() }).from(s.orgUsers)
        .where(and(
          eq(s.orgUsers.orgId, orgId),
          eq(s.orgUsers.roleKey, roleKey),
          eq(s.orgUsers.status, 'active'),
        ));
      return row?.n ?? 0;
    },

    async getSeats(licenseId, roleKey) {
      const [row] = await conn.select().from(s.licenseRoles)
        .where(and(
          eq(s.licenseRoles.licenseId, licenseId),
          eq(s.licenseRoles.roleKey, roleKey),
        )).limit(1);
      if (!row) return null;
      return { seats: row.seats, scopes: row.scopes ? asStringArray(row.scopes) : null };
    },

    async neverGatedScopes() {
      const rows = await conn.select({ slug: s.panelDefinitions.slug })
        .from(s.panelDefinitions)
        .where(eq(s.panelDefinitions.neverGated, true));
      return rows.map((r) => r.slug);
    },

    async createUser({ orgId, identity, roleKey, status, pendingReason, source }) {
      const [row] = await conn.insert(s.orgUsers).values({
        orgId,
        autodeskId: identity.autodeskId,
        email: identity.email,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        givenName: identity.givenName,
        familyName: identity.familyName,
        roleKey,
        status,
        pendingReason,
        source,
        // A row that starts pending has already been tried once: the sign-in
        // that created it. Counting from one keeps "attempts" honest on the
        // queue rather than showing 0 for somebody who was just refused.
        attemptCount: status === 'pending' ? 1 : 0,
        lastAttemptAt: status === 'pending' ? new Date() : null,
      }).returning();
      return toUserRow(row!);
    },

    /**
     * The auto-assign rule made durable. Audited with the add-in as actor
     * because no operator clicked anything — the seat existed and the person
     * signed in — and a status change with no audit row is the one that gets
     * asked about six months later.
     */
    async activateUser(userId) {
      const [before] = await conn.select().from(s.orgUsers)
        .where(eq(s.orgUsers.id, userId)).limit(1);
      const [after] = await conn.update(s.orgUsers)
        .set({ status: 'active', pendingReason: null, updatedAt: new Date() })
        .where(eq(s.orgUsers.id, userId))
        .returning();
      if (!after) return;
      await writeAudit({
        orgId: after.orgId,
        actorType: 'addin',
        action: 'user.auto_activate',
        targetType: 'org_user',
        targetId: userId,
        before: before ? { status: before.status, pendingReason: before.pendingReason } : null,
        after: { status: after.status, roleKey: after.roleKey },
      }, conn);
    },

    async recordAttempt(userId, reason) {
      await conn.update(s.orgUsers)
        .set({
          attemptCount: sql`${s.orgUsers.attemptCount} + 1`,
          lastAttemptAt: new Date(),
          // `undefined` leaves the column alone, which is what a rejected row
          // needs: its reason must stay null under the CHECK constraint.
          pendingReason: reason,
        })
        .where(eq(s.orgUsers.id, userId));
    },

    async upsertAccessRequest({ identity, device, reason, emailDomain: domain }) {
      await conn.insert(s.accessRequests).values({
        autodeskId: identity.autodeskId,
        email: identity.email,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        reason,
        emailDomain: domain || emailDomain(identity.email),
        deviceHash: device.deviceHash,
        machineName: device.machineName,
        revitVersion: device.revitVersion,
      }).onConflictDoUpdate({
        target: [s.accessRequests.email, s.accessRequests.deviceHash],
        set: {
          attemptCount: sql`${s.accessRequests.attemptCount} + 1`,
          lastAttemptAt: new Date(),
          reason,
        },
      });
    },

    today() {
      return new Date().toISOString().slice(0, 10);
    },
  };
}

/**
 * Tier 1 backfill. resolveUser can match an operator-created row by email
 * alone; without this the row never gains its autodesk_id and every later
 * login pays for the email lookup — and an email change orphans the account.
 * Only ever fills blanks, so an operator's edits are not overwritten.
 */
export async function backfillIdentity(
  conn: DbConn,
  userId: string,
  identity: AutodeskIdentity,
): Promise<void> {
  await conn.update(s.orgUsers)
    .set({
      autodeskId: sql`COALESCE(${s.orgUsers.autodeskId}, ${identity.autodeskId})`,
      email: sql`COALESCE(${s.orgUsers.email}, ${identity.email})`,
      displayName: sql`COALESCE(${s.orgUsers.displayName}, ${identity.displayName ?? null})`,
      givenName: sql`COALESCE(${s.orgUsers.givenName}, ${identity.givenName ?? null})`,
      familyName: sql`COALESCE(${s.orgUsers.familyName}, ${identity.familyName ?? null})`,
      emailVerified: sql`${s.orgUsers.emailVerified} OR ${identity.emailVerified}`,
      updatedAt: new Date(),
    })
    .where(eq(s.orgUsers.id, userId));
}

/** Drives the "last activity" column on the People tab. */
export async function touchActivity(conn: DbConn, userId: string): Promise<void> {
  await conn.update(s.orgUsers)
    .set({ lastActivityAt: new Date() })
    .where(eq(s.orgUsers.id, userId));
}

export type { AutodeskIdentity, DeviceInfo };
