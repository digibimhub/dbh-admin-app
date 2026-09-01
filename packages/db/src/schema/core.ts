import {
  pgTable, pgEnum, uuid, text, boolean, integer, smallint, bigint,
  timestamp, date, jsonb, inet, index, uniqueIndex, check, foreignKey, primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, textArray } from './types';

export const portalRole = pgEnum('portal_role', ['owner', 'admin', 'support', 'viewer']);
/**
 * Two values, not five. `trial` is a licence mode now, and `expired` /
 * `churned` were enum values no code path could ever produce — the nightly
 * job moves `licenses.status`, never this column. What is left is the only
 * question this column ever answered: is the customer switched on.
 */
export const orgStatus = pgEnum('org_status', ['active', 'suspended']);
export const licenseMode = pgEnum('license_mode', ['internal', 'trial', 'standard']);
export const licenseStatus = pgEnum('license_status', ['active', 'suspended', 'expired']);

export const portalUsers = pgTable('portal_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  displayName: text('display_name'),
  role: portalRole('role').notNull().default('viewer'),
  isActive: boolean('is_active').notNull().default(true),

  passwordHash: text('password_hash'),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  mustChangePassword: boolean('must_change_password').notNull().default(false),

  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  totpEnrolledAt: timestamp('totp_enrolled_at', { withTimezone: true }),
  totpResetRequired: boolean('totp_reset_required').notNull().default(false),
  lastTotpCounter: bigint('last_totp_counter', { mode: 'number' }).notNull().default(0),

  sessionEpoch: integer('session_epoch').notNull().default(1),

  failedAttempts: smallint('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),

  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastLoginIp: inet('last_login_ip'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_portal_users_active').on(t.isActive).where(sql`is_active`),
  check('portal_user_has_password', sql`NOT ${t.isActive} OR ${t.passwordHash} IS NOT NULL`),
  // Self-reference: who created this portal user. Declared here because a
  // column cannot reference its own table inline in Drizzle.
  foreignKey({
    name: 'portal_users_created_by_fk',
    columns: [t.createdBy],
    foreignColumns: [t.id],
  }),
]);

/**
 * Member roles, as data rather than an enum, so an operator can add one
 * without a deploy.
 *
 * `key` is immutable and is what everything else references: `org_users`,
 * `license_roles`, and the `role` claim on the add-in token. `name` is the
 * mutable display string and the ONLY thing any screen renders — so renaming
 * "Coordinator" to "Lead Coordinator" is a single UPDATE that rewrites no
 * other row. `patchRoleSchema` deliberately omits `key` so the API cannot
 * rename one even by accident; this mirrors `panel_definitions`, where the
 * slug is the contract and the label is the presentation.
 *
 * `scopes` is what the add-in actually gates features on. It holds
 * `panel_definitions.slug` values; never-gated slugs are unioned in at
 * resolution regardless of what is stored here.
 *
 * Retirement is `is_active = false`, never DELETE — a deleted role would
 * orphan every historical `org_users` row that referenced it.
 */
export const roles = pgTable('roles', {
  key: text('key').primaryKey(),
  name: citext('name').notNull().unique(),
  description: text('description'),
  scopes: textArray('scopes').notNull().default(sql`'{}'`),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Granted on auto-provision. Exactly one row may set this. */
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uniq_default_role').on(t.isDefault).where(sql`is_default`),
]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  primaryContactEmail: citext('primary_contact_email'),
  status: orgStatus('status').notNull().default('active'),

  createdBy: uuid('created_by').references(() => portalUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_org_status').on(t.status)]);

/**
 * A registered email domain, globally unique.
 *
 * The global unique is the whole point: it makes "which organisation does
 * this person belong to" a lookup with one answer instead of a set to
 * disambiguate, which is what the retired `multiple_orgs` deny code existed
 * for. Two customers cannot both claim `acme.com`; the second attempt is a
 * 409 naming the first.
 */
export const orgDomains = pgTable('org_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  value: citext('value').notNull(),

  createdBy: uuid('created_by').references(() => portalUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uniq_domain_global').on(t.value),
  index('idx_org_domains_org').on(t.orgId),
]);

export const blockedDomains = pgTable('blocked_domains', {
  value: citext('value').primaryKey(),
  reason: text('reason').notNull().default('public_mailbox'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Catalog of the capabilities the add-in understands — the scope vocabulary.
 *
 * Slugs mirror the `Panels` array in the add-in's RibbonBuilder.cs and are
 * compiled into shipped DLLs, so this table is append-only in practice:
 * renaming a slug fails nowhere and silently hides a feature in the field.
 *
 * Roles grant these slugs (`roles.scopes`); a licence may override the grant
 * per role (`license_roles.scopes`). The catalog itself is unchanged by that
 * move — only what points at it changed.
 */
export const panelDefinitions = pgTable('panel_definitions', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  /**
   * Granted to everyone whatever their role or licence. `general` carries
   * About, Updates and Sign in — if a licensing failure could hide it, the
   * failure would also remove the means of fixing it. Unioned in during
   * scope resolution, so no configuration can drop it.
   */
  neverGated: boolean('never_gated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const licenses = pgTable('licenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),

  mode: licenseMode('mode').notNull().default('trial'),
  status: licenseStatus('status').notNull().default('active'),

  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  graceDays: smallint('grace_days').notNull().default(7),

  createdBy: uuid('created_by').references(() => portalUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_licenses_org').on(t.orgId),
  index('idx_licenses_expiry').on(t.endDate).where(sql`status = 'active'`),
  uniqueIndex('uniq_active_license_per_org').on(t.orgId).where(sql`status = 'active'`),
  check('license_dates_valid', sql`${t.endDate} >= ${t.startDate}`),
  check('license_grace_sane', sql`${t.graceDays} BETWEEN 0 AND 90`),
]);

/**
 * Seats, and optionally scopes, for one role on one licence.
 *
 * Seats are a limit, never a tally — occupancy is
 * `count(*) FROM org_users WHERE org_id = ? AND role_key = ? AND status = 'active'`.
 * Deriving it is what makes a role change correct for free: moving somebody
 * from `user` to `admin` frees a user seat and takes an admin seat in the one
 * statement that changes `role_key`. A stored counter would need two writes
 * and would drift the first time one of them failed.
 *
 * `scopes` is null in the ordinary case, meaning "use the role's own list".
 * It exists for the customer who needs to differ from the default.
 */
export const licenseRoles = pgTable('license_roles', {
  licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'cascade' }),
  roleKey: text('role_key').notNull().references(() => roles.key),
  seats: integer('seats').notNull().default(0),
  scopes: textArray('scopes'),
}, (t) => [
  primaryKey({ columns: [t.licenseId, t.roleKey] }),
  check('license_role_seats_sane', sql`${t.seats} >= 0`),
]);

export const licenseEvents = pgTable('license_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  oldEndDate: date('old_end_date'),
  newEndDate: date('new_end_date'),
  oldStatus: licenseStatus('old_status'),
  newStatus: licenseStatus('new_status'),
  reason: text('reason'),
  actorId: uuid('actor_id').references(() => portalUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_license_events_license').on(t.licenseId, t.createdAt.desc())]);

export const signingKeys = pgTable('signing_keys', {
  kid: text('kid').primaryKey(),
  algorithm: text('algorithm').notNull().default('ES256'),
  publicKey: text('public_key').notNull(),
  privateRef: text('private_ref').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  actorEmail: citext('actor_email'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  ip: inet('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_audit_org_time').on(t.orgId, t.createdAt.desc()),
  index('idx_audit_actor').on(t.actorId, t.createdAt.desc()),
  index('idx_audit_action').on(t.action, t.createdAt.desc()),
]);
