/**
 * Local mirrors of the API response shapes.
 *
 * These deliberately duplicate the Zod schemas in `packages/shared` rather than
 * importing them: the admin app is a browser bundle that talks to the API over
 * HTTP only, and pulling the shared package in would drag Zod (and its Node
 * build graph) into the client bundle. Keep the two in sync by hand — every
 * field below maps 1:1 onto a column in `packages/db/src/schema`.
 */

export type PortalRole = 'owner' | 'admin' | 'support' | 'viewer';
export type OrgStatus = 'active' | 'suspended';
export type LicenseMode = 'internal' | 'trial' | 'standard';
export type LicenseStatus = 'active' | 'suspended' | 'expired';
export type MemberStatus = 'active' | 'pending' | 'disabled';
export type MemberSource = 'import' | 'auto_domain' | 'manual' | 'approved_request';
export type DeviceStatus = 'active' | 'disabled' | 'stale';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export const PORTAL_ROLES: PortalRole[] = ['owner', 'admin', 'support', 'viewer'];
export const ORG_STATUSES: OrgStatus[] = ['active', 'suspended'];
export const LICENSE_MODES: LicenseMode[] = ['internal', 'trial', 'standard'];
export const LICENSE_STATUSES: LicenseStatus[] = ['active', 'suspended', 'expired'];
export const MEMBER_STATUSES: MemberStatus[] = ['active', 'pending', 'disabled'];
export const MEMBER_SOURCES: MemberSource[] = [
  'import', 'auto_domain', 'manual', 'approved_request',
];
export const DEVICE_STATUSES: DeviceStatus[] = ['active', 'disabled', 'stale'];

export const SOURCE_LABEL: Record<MemberSource, string> = {
  import: 'Imported',
  auto_domain: 'Autodesk domain',
  manual: 'Added manually',
  approved_request: 'Approved request',
};

export const MODE_LABEL: Record<LicenseMode, string> = {
  internal: 'Internal',
  trial: 'Trial',
  standard: 'Standard',
};

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: PortalRole;
  totpEnabled: boolean;
  totpResetRequired: boolean;
};

export type PortalUserRow = {
  id: string;
  email: string;
  displayName: string | null;
  role: PortalRole;
  isActive: boolean;
  totpEnabled: boolean;
  totpResetRequired: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

/* ----------------------------------------------------------------- roles */

/**
 * A member role.
 *
 * `key` is immutable and is what every other row references; `name` is the
 * only thing rendered anywhere and is freely editable. That split is why
 * renaming a role changes no data.
 */
export type Role = {
  key: string;
  name: string;
  description: string | null;
  scopes: string[];
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** `GET /admin/roles` adds the count a deactivation would affect. */
export type RoleRow = Role & { activeMembers: number };

/* --------------------------------------------------------- organisations */

export type Organization = {
  id: string;
  slug: string;
  name: string;
  status: OrgStatus;
  primaryContactEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A row of `GET /admin/orgs` — the org plus what the list needs to show. */
export type OrgListRow = Organization & {
  mode: LicenseMode | null;
  licenseEnd: string | null;
  activeUsers: number;
  pendingUsers: number;
  totalSeats: number;
};

export type License = {
  id: string;
  orgId: string;
  mode: LicenseMode;
  status: LicenseStatus;
  startDate: string;
  endDate: string;
  graceDays: number;
  createdAt: string;
  updatedAt: string;
};

/** Seats for one role on one licence, with live occupancy. */
export type SeatRow = {
  roleKey: string;
  name: string;
  seats: number;
  used: number;
  sortOrder: number;
  scopes?: string[] | null;
  isActive?: boolean;
};

export type LicenseEvent = {
  id: string;
  licenseId: string;
  eventType: string;
  oldEndDate: string | null;
  newEndDate: string | null;
  oldStatus: LicenseStatus | null;
  newStatus: LicenseStatus | null;
  reason: string | null;
  actorId: string | null;
  createdAt: string;
};

export type OrgDomain = {
  id: string;
  orgId: string;
  value: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrgUser = {
  id: string;
  orgId: string;
  autodeskId: string | null;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
  roleKey: string;
  status: MemberStatus;
  source: MemberSource;
  firstSeenAt: string;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserRow = {
  user: OrgUser;
  orgName: string;
  orgSlug: string;
  roleName: string;
};

export type Device = {
  id: string;
  orgId: string;
  orgUserId: string | null;
  deviceHash: string;
  machineName: string | null;
  revitVersions: string[];
  addinVersion: string | null;
  status: DeviceStatus;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type DeviceRow = {
  device: Device;
  orgName: string;
  userEmail: string | null;
  userName: string | null;
};

export type AccessRequest = {
  id: string;
  autodeskId: string | null;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  reason: string;
  emailDomain: string | null;
  deviceHash: string;
  machineName: string | null;
  revitVersion: string | null;
  status: RequestStatus;
  attemptCount: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  assignedOrgId: string | null;
  grantedRoleKey: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

export type AuditEntry = {
  id: number;
  orgId: string | null;
  actorType: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  beforeState: unknown;
  afterState: unknown;
  ip: string | null;
  createdAt: string;
};

/**
 * The scope catalog. Roles grant these slugs; the add-in gates features on
 * them and never on a role name.
 */
export type PanelDefinition = {
  slug: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Granted to everyone whatever their role or licence. */
  neverGated: boolean;
};

export type Paged<T> = { rows: T[]; total: number; page: number; pageSize: number };

export type OrgDetail = {
  org: Organization;
  license: License | null;
  domains: OrgDomain[];
  seats: SeatRow[];
  counts: { users: number; pending: number; devices: number };
  lastActivityAt: string | null;
};

export type Dashboard = {
  orgs: { total: number; suspended: number };
  people: { active: number; pending: number };
  devices: { active: number };
  licenses: {
    byMode: Partial<Record<LicenseMode, number>>;
    expiringSoon: number;
    expired: number;
  };
  pendingRequests: number;
  overCap: { id: string; name: string; role_name: string; seats: number; used: number }[];
};

/* ------------------------------------------------------------- CSV import */

export type ImportAction = 'create' | 'update' | 'unchanged' | 'conflict' | 'invalid';

/** One row of the server-built import plan. Sent back verbatim on commit. */
export type ImportPlanRow = {
  line: number;
  action: ImportAction;
  email: string;
  displayName?: string | null;
  roleKey?: string;
  existingUserId?: string | null;
  message?: string;
};

export type ImportPreview = {
  orgId: string;
  /** Integrity token — commit only applies a plan that matches its preview. */
  token: string;
  summary: Partial<Record<ImportAction, number>>;
  rows: ImportPlanRow[];
};

export type ImportResult = {
  created: number;
  updated: number;
  /** Rows the seat count would not accommodate. */
  skippedNoSeat?: number;
  skipped?: { email: string; reason: string }[];
};

/* ---------------------------------------------------------------- audit */

export type AuditRow = { entry: AuditEntry; orgName: string | null };

/* ------------------------------------------------------------- licences */

export type LicenseEventRow = {
  event: LicenseEvent;
  actorEmail: string | null;
};

/* -------------------------------------------------------------- devices */

export type UserDeviceRow = { device: Device; lastUsage: string | null };

export type DeviceUsage = {
  device: Device;
  days: number;
  totals: { launches: number; heartbeats: number; activeMinutes: number; activeDays: number };
  daily: {
    usageDate: string;
    launches: number;
    heartbeats: number;
    activeMinutes: number;
    revitVersion: string | null;
    addinVersion: string | null;
    userEmail: string | null;
  }[];
};
