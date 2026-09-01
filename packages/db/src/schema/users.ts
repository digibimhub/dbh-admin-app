import {
  pgTable, pgEnum, uuid, text, boolean, integer, timestamp, date,
  jsonb, index, uniqueIndex, check, primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, textArray } from './types';
import { organizations, portalUsers, roles } from './core';

/**
 * `pending` means a seat was not available when this person signed in. They
 * exist, they are attached to the right organisation, and they are waiting on
 * an operator to free a seat or raise the count — which is why they are a row
 * here and not an access request.
 */
export const memberStatus = pgEnum('member_status', ['active', 'pending', 'disabled']);
/** `auto_acc` is gone with tier-2 ACC resolution. */
export const memberSource = pgEnum('member_source', [
  'import', 'auto_domain', 'manual', 'approved_request',
]);
export const deviceStatus = pgEnum('device_status', ['active', 'disabled', 'stale']);
export const requestStatus = pgEnum('request_status', ['pending', 'approved', 'rejected', 'expired']);

export const orgUsers = pgTable('org_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),

  autodeskId: text('autodesk_id'),
  email: citext('email'),
  emailVerified: boolean('email_verified').notNull().default(false),

  // Everything the Autodesk OIDC profile returns, and nothing invented.
  displayName: text('display_name'),
  givenName: text('given_name'),
  familyName: text('family_name'),

  roleKey: text('role_key').notNull().references(() => roles.key),
  status: memberStatus('status').notNull().default('active'),
  source: memberSource('source').notNull().default('auto_domain'),

  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),

  createdBy: uuid('created_by').references(() => portalUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uniq_user_autodesk_global').on(t.autodeskId).where(sql`autodesk_id IS NOT NULL`),
  uniqueIndex('uniq_user_email_global').on(t.email).where(sql`email IS NOT NULL`),
  index('idx_org_users_org_status').on(t.orgId, t.status),
  // Seat occupancy is counted off this index: (org, role) where active.
  index('idx_org_users_org_role').on(t.orgId, t.roleKey, t.status),
  index('idx_org_users_activity').on(t.orgId, sql`last_activity_at DESC NULLS LAST`),
  check('org_user_has_identity', sql`${t.autodeskId} IS NOT NULL OR ${t.email} IS NOT NULL`),
]);

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orgUserId: uuid('org_user_id').references(() => orgUsers.id, { onDelete: 'set null' }),

  deviceHash: text('device_hash').notNull(),
  machineName: text('machine_name'),

  // Revit lives here, not on the person. There is no Revit account — this is
  // telemetry about a workstation, reported by the add-in.
  revitVersions: textArray('revit_versions').notNull().default(sql`'{}'`),
  addinVersion: text('addin_version'),

  status: deviceStatus('status').notNull().default('active'),

  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uniq_device_per_org').on(t.orgId, t.deviceHash),
  index('idx_devices_user').on(t.orgUserId),
  index('idx_devices_org_seen').on(t.orgId, t.lastSeenAt.desc()),
  index('idx_devices_stale').on(t.lastSeenAt).where(sql`status = 'active'`),
]);

/**
 * A signed-in add-in installation.
 *
 * Refresh tokens are stored only as SHA-256 hashes and are rotated on every
 * successful validation. `previousTokenHash` exists so a rotation whose reply
 * was lost can be answered idempotently rather than treated as theft: a stale
 * token presented inside the replay window gets the current token back, and
 * one presented after it revokes the session. Without that window a dropped
 * response is indistinguishable from a stolen token, and the user is signed
 * out mid-model for a network blip.
 *
 * `expiresAt` slides forward on each refresh so an active user never hits a
 * wall; `maxLifetimeAt` is fixed at issue and is the horizon a stolen token
 * cannot outlive.
 */
export const addinSessions = pgTable('addin_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orgUserId: uuid('org_user_id').notNull().references(() => orgUsers.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),

  refreshTokenHash: text('refresh_token_hash').notNull().unique(),
  previousTokenHash: text('previous_token_hash'),
  previousRotatedAt: timestamp('previous_rotated_at', { withTimezone: true }),

  apsAccessTokenEnc: text('aps_access_token_enc'),
  apsRefreshTokenEnc: text('aps_refresh_token_enc'),
  apsExpiresAt: timestamp('aps_expires_at', { withTimezone: true }),
  apsScopes: text('aps_scopes'),

  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  maxLifetimeAt: timestamp('max_lifetime_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
}, (t) => [
  index('idx_addin_sessions_user').on(t.orgUserId).where(sql`revoked_at IS NULL`),
  index('idx_addin_sessions_device').on(t.deviceId),
  index('idx_addin_sessions_previous').on(t.previousTokenHash).where(sql`previous_token_hash IS NOT NULL`),
]);

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  codeChallenge: text('code_challenge').notNull(),
  deviceHash: text('device_hash'),
  /**
   * The browser-handoff payload: the hashed handoff token, the verified
   * Autodesk identity and the APS tokens, all written at callback time and
   * redeemed once at /exchange. Encrypted fields are encrypted before they
   * reach this column; the row itself is purged hourly by `cleanup`.
   */
  deviceInfo: jsonb('device_info'),
  redirectPort: integer('redirect_port'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_oauth_states_expiry').on(t.expiresAt)]);

/**
 * Somebody who signed in and could not be placed in an organisation.
 *
 * With domains globally unique there is no ambiguity left to record: either
 * the domain maps to exactly one org — in which case a member row is created,
 * `active` or `pending` — or it maps to none and lands here. `candidate_orgs`
 * and `acc_accounts` are gone with the cases that produced them.
 */
export const accessRequests = pgTable('access_requests', {
  id: uuid('id').primaryKey().defaultRandom(),

  autodeskId: text('autodesk_id'),
  email: citext('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  displayName: text('display_name'),

  reason: text('reason').notNull(),
  emailDomain: citext('email_domain'),

  deviceHash: text('device_hash').notNull(),
  machineName: text('machine_name'),
  revitVersion: text('revit_version'),

  status: requestStatus('status').notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(1),
  firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull().defaultNow(),

  assignedOrgId: uuid('assigned_org_id').references(() => organizations.id, { onDelete: 'set null' }),
  grantedRoleKey: text('granted_role_key').references(() => roles.key),
  reviewedBy: uuid('reviewed_by').references(() => portalUsers.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
}, (t) => [
  uniqueIndex('uniq_request_email_device').on(t.email, t.deviceHash),
  index('idx_access_requests_pending')
    .on(t.status, t.lastAttemptAt.desc()).where(sql`status = 'pending'`),
]);

export const usageDaily = pgTable('usage_daily', {
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orgUserId: uuid('org_user_id').notNull().references(() => orgUsers.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  usageDate: date('usage_date').notNull(),

  launches: integer('launches').notNull().default(0),
  heartbeats: integer('heartbeats').notNull().default(0),
  activeMinutes: integer('active_minutes').notNull().default(0),
  revitVersion: text('revit_version'),
  addinVersion: text('addin_version'),

  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.orgUserId, t.deviceId, t.usageDate] }),
  index('idx_usage_daily_org_date').on(t.orgId, t.usageDate.desc()),
  index('idx_usage_daily_date').on(t.usageDate),
]);
