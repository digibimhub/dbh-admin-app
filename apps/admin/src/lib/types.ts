/**
 * Local mirrors of the API response shapes.
 *
 * These deliberately duplicate the Zod schemas in `packages/shared` rather than
 * importing them: the admin app is a browser bundle that talks to the API over
 * HTTP only, and pulling the shared package in would drag Zod (and its Node
 * build graph) into the client bundle. Keep the two in sync by hand — every
 * field below maps 1:1 onto a column in `packages/db/src/schema`.
 */

export type PortalRole = 'owner' | 'admin' | 'support' | 'viewer' | 'org_admin';
/** The roles a portal user can be given from Portal users. `org_admin` is minted per organisation. */
export type GlobalPortalRole = Exclude<PortalRole, 'org_admin'>;
export type JoinPolicy = 'automatic' | 'approval';
export type PendingReason = 'awaiting_approval' | 'seats_exhausted' | 'no_licence';
export type OrgStatus = 'active' | 'suspended';
export type LicenseMode = 'internal' | 'trial' | 'standard';
export type LicenseStatus = 'active' | 'suspended' | 'expired';
export type MemberStatus = 'active' | 'pending' | 'disabled' | 'rejected';
export type MemberSource = 'import' | 'auto_domain' | 'manual' | 'approved_request';
export type DeviceStatus = 'active' | 'disabled' | 'stale';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export const PORTAL_ROLES: PortalRole[] = ['owner', 'admin', 'support', 'viewer', 'org_admin'];
export const GLOBAL_PORTAL_ROLES: GlobalPortalRole[] = ['owner', 'admin', 'support', 'viewer'];
export const JOIN_POLICIES: JoinPolicy[] = ['automatic', 'approval'];
export const ORG_STATUSES: OrgStatus[] = ['active', 'suspended'];
export const LICENSE_MODES: LicenseMode[] = ['internal', 'trial', 'standard'];
export const LICENSE_STATUSES: LicenseStatus[] = ['active', 'suspended', 'expired'];
export const MEMBER_STATUSES: MemberStatus[] = ['active', 'pending', 'disabled', 'rejected'];
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

/**
 * What `/admin/auth/me` adds beside the account row. `capabilities` is the
 * server's own list and wins over the local matrix in `permissions.ts`;
 * `scope` is `org` for an organisation admin, who then carries the org.
 */
export type SessionExtras = {
  scope: 'global' | 'org';
  orgId: string | null;
  orgName: string | null;
  orgStatus: OrgStatus | null;
  joinPolicy: JoinPolicy | null;
  capabilities: string[];
  mustChangePassword: boolean;
};

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: PortalRole;
  totpEnabled: boolean;
  totpResetRequired: boolean;
  totpEnrolledAt: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
} & Partial<SessionExtras>;

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
  /** Set on `org_admin` rows only. */
  orgId?: string | null;
  orgName?: string | null;
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
  /** Absent until the API carries it; the Joining control hides itself then. */
  joinPolicy?: JoinPolicy;
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
  /** Why a pending row is pending. Stored, not derived. */
  pendingReason?: PendingReason | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  attemptCount?: number;
  lastAttemptAt?: string | null;
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

/** Pending members by reason, plus the rejected count. */
export type RequestCounts = {
  awaitingApproval: number;
  seatsExhausted: number;
  noLicence: number;
  rejected: number;
};

export type OrgDetail = {
  org: Organization;
  license: License | null;
  domains: OrgDomain[];
  seats: SeatRow[];
  counts: { users: number; pending: number; devices: number } & Partial<RequestCounts>;
  lastActivityAt: string | null;
};

/* ------------------------------------------------------- member requests */

/** One row of `GET /admin/orgs/:id/requests`. */
export type OrgRequestRow = {
  user: OrgUser;
  roleName: string;
  reviewedByEmail: string | null;
};

/** Seat usage as the requests endpoint reports it; `SeatRow` names the role `name` instead. */
export type SeatUsage = {
  roleKey: string;
  roleName?: string;
  name?: string;
  seats: number;
  used: number;
};

export type OrgRequestsResponse = {
  rows: OrgRequestRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  counts: RequestCounts;
  licence: { active: boolean; endDate: string | null };
  seats: SeatUsage[];
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
  /** Active licences inside 30 days, already ordered by end date. */
  endingSoon: {
    orgId: string;
    orgName: string;
    mode: LicenseMode;
    endDate: string;
  }[];
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

/** What a plan will ask of the licence, per role. Advisory — nothing is reserved. */
export type SeatForecast = {
  roleKey: string;
  roleName: string;
  seats: number;
  used: number;
  free: number;
  wanted: number;
  shortfall: number;
};

export type ImportPreview = {
  orgId: string;
  /** Integrity token — commit only applies a plan that matches its preview. */
  token: string;
  summary: Partial<Record<ImportAction, number>>;
  rows: ImportPlanRow[];
  seatForecast?: SeatForecast[];
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
