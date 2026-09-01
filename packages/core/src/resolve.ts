/**
 * resolveUser — the core of the licensing system.
 *
 * Everything else is CRUD around this function. It decides, from an
 * Autodesk-verified identity, which organisation a person belongs to and what
 * they are allowed to do.
 *
 * TRUST MODEL
 * -----------
 * The only inputs trusted here come from Autodesk, obtained by our server
 * exchanging the OAuth code directly. Nothing the add-in asserts about the
 * machine (Windows domain SID, AD object GUID, Entra tenant) is used: a
 * patched DLL can send anything, so those signals are worthless for access
 * control. deviceHash and machineName are recorded for analytics only.
 *
 * RESOLUTION ORDER
 * ----------------
 *   1. Known user      org_users by autodesk_id (globally unique)
 *   2. Email domain    verified email domain -> org_domains (globally unique)
 *   3. Neither         upsert access_request, deny
 *
 * Step 2 only ever runs on a person's first login. After that step 1 answers
 * immediately.
 *
 * There is no tier for ACC accounts any more. It existed to break ties when
 * several organisations claimed one email domain; `org_domains.value` is now
 * globally unique, so there are no ties.
 */

export type DenyCode =
  | 'email_not_verified'
  | 'domain_not_registered'
  | 'pending_approval'
  | 'seats_exhausted'
  | 'user_disabled'
  | 'device_disabled'
  | 'org_suspended'
  | 'license_missing'
  | 'license_suspended'
  | 'license_expired'
  | 'license_not_started'
  | 'offline_grace_exceeded'
  | 'invalid_token';

/** Verified server-side during the OAuth code exchange. */
export interface AutodeskIdentity {
  autodeskId: string;      // OIDC 'sub'
  email: string;
  emailVerified: boolean;
  displayName?: string;
  givenName?: string;
  familyName?: string;
}

/** Recorded, never trusted for access decisions. */
export interface DeviceInfo {
  deviceHash: string;
  machineName?: string;
  revitVersion?: string;
  addinVersion?: string;
}

export interface OrgRow {
  id: string;
  name: string;
  status: 'active' | 'suspended';
}

export interface LicenseRow {
  id: string;
  orgId: string;
  mode: 'internal' | 'trial' | 'standard';
  status: 'active' | 'suspended' | 'expired';
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD, INCLUSIVE
  graceDays: number;
}

export interface UserRow {
  id: string;
  orgId: string;
  roleKey: string;
  status: 'active' | 'pending' | 'disabled';
}

export interface RoleRow {
  key: string;
  name: string;
  scopes: string[];
  isActive: boolean;
}

/** Seats, and the optional per-licence scope override, for one role. */
export interface SeatRow {
  seats: number;
  scopes: string[] | null;
}

export interface DeviceRow {
  id: string;
  status: 'active' | 'disabled' | 'stale';
}

/** Everything resolveUser needs from the database, injected so it is testable. */
export interface ResolveDeps {
  findUserByAutodeskId(autodeskId: string): Promise<UserRow | null>;
  findUserByEmail(email: string): Promise<UserRow | null>;
  /** At most one, because org_domains.value is globally unique. */
  findOrgByEmailDomain(domain: string): Promise<OrgRow | null>;
  getOrg(orgId: string): Promise<OrgRow | null>;
  getActiveLicense(orgId: string): Promise<LicenseRow | null>;
  getDevice(orgId: string, deviceHash: string): Promise<DeviceRow | null>;
  getRole(roleKey: string): Promise<RoleRow | null>;
  /** The role granted on auto-provision. Exactly one row may be the default. */
  getDefaultRole(): Promise<RoleRow | null>;
  /** Seat occupancy: active members of this org holding this role. */
  countActiveInRole(orgId: string, roleKey: string): Promise<number>;
  getSeats(licenseId: string, roleKey: string): Promise<SeatRow | null>;
  /** Slugs granted to everyone whatever their role or licence. */
  neverGatedScopes(): Promise<string[]>;
  createUser(input: {
    orgId: string;
    identity: AutodeskIdentity;
    roleKey: string;
    status: 'active' | 'pending';
    source: 'auto_domain';
  }): Promise<UserRow>;
  upsertAccessRequest(input: {
    identity: AutodeskIdentity;
    device: DeviceInfo;
    reason: DenyCode;
    emailDomain: string;
  }): Promise<void>;
  /** ISO date in the org's reference timezone. Injected so tests are stable. */
  today(): string;
}

export type ResolveResult =
  | {
      ok: true;
      orgId: string;
      orgName: string;
      userId: string;
      roleKey: string;
      scopes: string[];
      license: LicenseRow;
      tier: 1 | 2;
      source: 'existing' | 'auto_domain';
    }
  | { ok: false; code: DenyCode };

export function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/**
 * Offline grace is measured from the last SUCCESSFUL validation, not from
 * token expiry. Measuring from expiry would give no grace at all to someone
 * who was already offline when their token lapsed.
 */
export function offlineGraceExceeded(
  daysSinceLastSuccess: number,
  graceDays: number,
): boolean {
  return daysSinceLastSuccess > graceDays;
}

/**
 * The capability list the add-in gates features on.
 *
 * A licence may override a role's grant; never-gated slugs are unioned in
 * afterwards and cannot be configured away. `general` carries About, Updates
 * and Sign in — a licensing mistake that hid it would also remove the means of
 * fixing it, so the union happens here, at the only point every grant passes
 * through, rather than in a route's validation where it can be bypassed.
 */
export function resolveScopes(
  role: RoleRow,
  seat: SeatRow | null,
  neverGated: string[],
): string[] {
  const granted = seat?.scopes ?? role.scopes;
  return [...new Set([...granted, ...neverGated])].sort();
}

export async function resolveUser(
  identity: AutodeskIdentity,
  device: DeviceInfo,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  let user: UserRow | null = null;
  let tier: 1 | 2 = 1;
  let source: 'existing' | 'auto_domain' = 'existing';

  // ---- Tier 1: known user -------------------------------------------
  // autodesk_id is globally unique, so this returns at most one row and the
  // org is unambiguous. This is every login after the first.
  user = await deps.findUserByAutodeskId(identity.autodeskId);
  if (!user && identity.emailVerified) {
    // Covers users added by an operator before their first sign-in, who have
    // an email on file but no autodesk_id yet. The caller backfills the id.
    user = await deps.findUserByEmail(identity.email);
  }

  if (!user) {
    const domain = emailDomain(identity.email);

    // ---- Tier 2: email domain ---------------------------------------
    if (!identity.emailVerified) {
      // An unverified address is a string the user typed. Autodesk has not
      // confirmed they control the mailbox, so it cannot map to an org.
      await deps.upsertAccessRequest({
        identity, device, reason: 'email_not_verified', emailDomain: domain,
      });
      return { ok: false, code: 'email_not_verified' };
    }

    const org = await deps.findOrgByEmailDomain(domain);
    if (!org) {
      await deps.upsertAccessRequest({
        identity, device, reason: 'domain_not_registered', emailDomain: domain,
      });
      return { ok: false, code: 'domain_not_registered' };
    }

    // Provisioning consumes a seat, and seats live on the licence — so
    // without one there is nothing to consume and nobody to attach. Deny and
    // record the attempt rather than creating a member row that no licence
    // accounts for.
    const licenseForSeat = await deps.getActiveLicense(org.id);
    if (!licenseForSeat) {
      await deps.upsertAccessRequest({
        identity, device, reason: 'license_missing', emailDomain: domain,
      });
      return { ok: false, code: 'license_missing' };
    }

    const defaultRole = await deps.getDefaultRole();
    if (!defaultRole || !defaultRole.isActive) {
      // A misconfiguration, not a decision about this person. Route them to
      // the approval queue so an operator sees it and nobody is silently
      // granted a role the system had to guess.
      await deps.upsertAccessRequest({
        identity, device, reason: 'pending_approval', emailDomain: domain,
      });
      return { ok: false, code: 'pending_approval' };
    }

    // Fill up to the seat count, then stop. Past it the person still becomes
    // a member — the right organisation, the right role — but `pending`, so
    // the operator sees exactly who is waiting and on which role.
    const seat = await deps.getSeats(licenseForSeat.id, defaultRole.key);
    const used = await deps.countActiveInRole(org.id, defaultRole.key);
    const hasRoom = used < (seat?.seats ?? 0);

    user = await deps.createUser({
      orgId: org.id,
      identity,
      roleKey: defaultRole.key,
      status: hasRoom ? 'active' : 'pending',
      source: 'auto_domain',
    });

    tier = 2;
    source = 'auto_domain';

    if (!hasRoom) return { ok: false, code: 'seats_exhausted' };
  }

  // ---- Gates ---------------------------------------------------------
  const org = await deps.getOrg(user.orgId);
  if (!org) return { ok: false, code: 'org_suspended' };
  if (org.status === 'suspended') return { ok: false, code: 'org_suspended' };

  const license = await deps.getActiveLicense(org.id);
  if (!license) return { ok: false, code: 'license_missing' };
  if (license.status === 'suspended') return { ok: false, code: 'license_suspended' };
  if (license.status !== 'active') return { ok: false, code: 'license_expired' };

  // endDate is INCLUSIVE: a license ending today is still valid today.
  const today = deps.today();
  if (today < license.startDate) return { ok: false, code: 'license_not_started' };
  if (today > license.endDate) return { ok: false, code: 'license_expired' };

  if (user.status === 'disabled') return { ok: false, code: 'user_disabled' };
  // Waiting on a seat. A soft denial: the session stays valid, so the moment
  // an operator raises the count the next check succeeds with no re-login.
  if (user.status === 'pending') return { ok: false, code: 'seats_exhausted' };

  const dev = await deps.getDevice(org.id, device.deviceHash);
  if (dev?.status === 'disabled') return { ok: false, code: 'device_disabled' };

  // ---- Grant ---------------------------------------------------------
  // A role that was deactivated does not lock out the people already holding
  // it — deactivation stops new assignment, and revoking working installs for
  // a settings change is exactly the interruption this system tries to avoid.
  const role = await deps.getRole(user.roleKey);
  if (!role) return { ok: false, code: 'pending_approval' };

  const seat = await deps.getSeats(license.id, user.roleKey);
  const scopes = resolveScopes(role, seat, await deps.neverGatedScopes());

  return {
    ok: true,
    orgId: org.id,
    orgName: org.name,
    userId: user.id,
    roleKey: user.roleKey,
    scopes,
    license,
    tier,
    source,
  };
}
