import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveUser, emailDomain, offlineGraceExceeded, resolveScopes,
  type ResolveDeps, type OrgRow, type LicenseRow, type UserRow, type RoleRow,
  type SeatRow, type AutodeskIdentity, type DeviceInfo,
} from './resolve.ts';

/* ---------------- fixtures ---------------- */

const ORG_A: OrgRow = { id: 'org-a', name: 'Acme Engineering', status: 'active' };

const LICENSE: LicenseRow = {
  id: 'lic-a', orgId: 'org-a', mode: 'standard', status: 'active',
  startDate: '2026-01-01', endDate: '2026-12-31', graceDays: 7,
};

const ROLE_USER: RoleRow = {
  key: 'user', name: 'User', scopes: ['cleanup', 'general'], isActive: true,
};
const ROLE_ADMIN: RoleRow = {
  key: 'admin', name: 'Admin',
  scopes: ['cleanup', 'parameters', 'excel', 'coordination', 'troubleshoot', 'general'],
  isActive: true,
};

const IDENTITY: AutodeskIdentity = {
  autodeskId: 'ABC123XYZ', email: 'j.smith@acme-eng.com', emailVerified: true,
  displayName: 'J Smith',
};
const DEVICE: DeviceInfo = { deviceHash: 'sha256:abc', machineName: 'BIM-WS-014' };

interface Overrides {
  user?: UserRow | null;
  userByEmail?: UserRow | null;
  domainOrg?: OrgRow | null;
  org?: OrgRow;
  license?: LicenseRow | null;
  device?: { id: string; status: 'active' | 'disabled' | 'stale' } | null;
  roles?: Record<string, RoleRow>;
  defaultRole?: RoleRow | null;
  /** Seats per role key. Absent means no seat row, i.e. zero seats. */
  seats?: Record<string, SeatRow>;
  used?: Record<string, number>;
  neverGated?: string[];
  today?: string;
}

/** Typed off ResolveDeps so a signature change breaks the test rather than
 *  silently widening it. */
type CapturedRequest = Parameters<ResolveDeps['upsertAccessRequest']>[0];
type CapturedCreate = Parameters<ResolveDeps['createUser']>[0];

function deps(o: Overrides = {}) {
  const requests: CapturedRequest[] = [];
  const created: CapturedCreate[] = [];
  const roles = o.roles ?? { user: ROLE_USER, admin: ROLE_ADMIN };
  const d: ResolveDeps = {
    findUserByAutodeskId: async () => o.user ?? null,
    findUserByEmail: async () => o.userByEmail ?? null,
    findOrgByEmailDomain: async () => (o.domainOrg === undefined ? ORG_A : o.domainOrg),
    getOrg: async () => o.org ?? ORG_A,
    getActiveLicense: async () => (o.license === undefined ? LICENSE : o.license),
    getDevice: async () => o.device ?? { id: 'dev-1', status: 'active' },
    getRole: async (key) => roles[key] ?? null,
    getDefaultRole: async () => (o.defaultRole === undefined ? ROLE_USER : o.defaultRole),
    countActiveInRole: async (_orgId, roleKey) => o.used?.[roleKey] ?? 0,
    getSeats: async (_licenseId, roleKey) => o.seats?.[roleKey] ?? null,
    neverGatedScopes: async () => o.neverGated ?? ['general'],
    createUser: async (input) => {
      created.push(input);
      return { id: 'new-user', orgId: input.orgId, roleKey: input.roleKey, status: input.status };
    },
    upsertAccessRequest: async (r) => { requests.push(r); },
    today: () => o.today ?? '2026-06-15',
  };
  return { d, requests, created };
}

const member = (p: Partial<UserRow> = {}): UserRow => ({
  id: 'u1', orgId: 'org-a', roleKey: 'user', status: 'active', ...p,
});

/** Ten seats for `user`, ten for `admin`, unless a test says otherwise. */
const ROOMY: Record<string, SeatRow> = {
  user: { seats: 10, scopes: null },
  admin: { seats: 10, scopes: null },
};

/* ---------------- helpers ---------------- */

describe('helpers', () => {
  test('emailDomain lowercases and extracts', () => {
    assert.equal(emailDomain('J.Smith@ACME-ENG.COM'), 'acme-eng.com');
  });
  test('emailDomain on malformed input returns empty string', () => {
    assert.equal(emailDomain('notanemail'), '');
  });
  test('grace measured from last success, boundary is inclusive', () => {
    assert.equal(offlineGraceExceeded(7, 7), false);
    assert.equal(offlineGraceExceeded(8, 7), true);
  });
});

/* ---------------- scope resolution ---------------- */

describe('resolveScopes', () => {
  test('a role with no override grants its own scopes', () => {
    assert.deepEqual(resolveScopes(ROLE_USER, null, ['general']), ['cleanup', 'general']);
  });

  test('a licence override replaces the role list, it does not merge with it', () => {
    const seat: SeatRow = { seats: 5, scopes: ['excel'] };
    assert.deepEqual(resolveScopes(ROLE_USER, seat, ['general']), ['excel', 'general']);
  });

  test('a null override falls back to the role, an empty one does not', () => {
    assert.deepEqual(resolveScopes(ROLE_USER, { seats: 5, scopes: null }, []), ['cleanup', 'general']);
    assert.deepEqual(resolveScopes(ROLE_USER, { seats: 5, scopes: [] }, []), []);
  });

  /**
   * The one that must never regress. `general` carries About, Updates and Sign
   * in — if configuration could drop it, a licensing mistake would also remove
   * the means of fixing it.
   */
  test('never-gated scopes survive a role and a licence that both omit them', () => {
    const bare: RoleRow = { key: 'user', name: 'User', scopes: [], isActive: true };
    assert.deepEqual(resolveScopes(bare, { seats: 1, scopes: [] }, ['general']), ['general']);
  });

  test('duplicates collapse', () => {
    assert.deepEqual(resolveScopes(ROLE_USER, null, ['general', 'cleanup']), ['cleanup', 'general']);
  });
});

/* ---------------- resolution order ---------------- */

describe('resolution order', () => {
  test('a known autodesk_id short-circuits, no access request is written', async () => {
    const { d, requests, created } = deps({ user: member(), seats: ROOMY });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.tier, 1);
      assert.equal(r.source, 'existing');
    }
    assert.equal(requests.length, 0);
    assert.equal(created.length, 0);
  });

  test('an unverified email never reaches the domain lookup', async () => {
    const { d, requests } = deps({ seats: ROOMY });
    const r = await resolveUser({ ...IDENTITY, emailVerified: false }, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'email_not_verified' });
    assert.equal(requests[0]?.reason, 'email_not_verified');
  });

  test('an unregistered domain denies and queues a request', async () => {
    const { d, requests } = deps({ domainOrg: null });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'domain_not_registered' });
    assert.equal(requests[0]?.reason, 'domain_not_registered');
    assert.equal(requests[0]?.emailDomain, 'acme-eng.com');
  });

  /**
   * A domain resolves to one organisation or to none — org_domains.value is
   * globally unique — so there is no ambiguity branch left to test. This is
   * what retired the `multiple_orgs` deny code.
   */
  test('a registered domain provisions into that one organisation', async () => {
    const { d, created } = deps({ seats: ROOMY });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.tier, 2);
      assert.equal(r.source, 'auto_domain');
      assert.equal(r.orgId, 'org-a');
    }
    assert.equal(created[0]?.roleKey, 'user');
    assert.equal(created[0]?.status, 'active');
  });

  test('no active licence means no seat to consume, so nobody is provisioned', async () => {
    const { d, created, requests } = deps({ license: null });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'license_missing' });
    assert.equal(created.length, 0, 'must not create a member no licence accounts for');
    assert.equal(requests[0]?.reason, 'license_missing');
  });

  test('a missing default role is a misconfiguration, not a rejection', async () => {
    const { d, created, requests } = deps({ defaultRole: null, seats: ROOMY });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'pending_approval' });
    assert.equal(created.length, 0);
    assert.equal(requests[0]?.reason, 'pending_approval');
  });
});

/* ---------------- seats ---------------- */

describe('seats', () => {
  test('auto-provision fills up to the seat count', async () => {
    const { d, created } = deps({
      seats: { user: { seats: 3, scopes: null } },
      used: { user: 2 },
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, true);
    assert.equal(created[0]?.status, 'active');
  });

  test('the seat after the last one lands pending and denies seats_exhausted', async () => {
    const { d, created } = deps({
      seats: { user: { seats: 3, scopes: null } },
      used: { user: 3 },
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'seats_exhausted' });
    // Still a member of the right org with the right role — just waiting.
    assert.equal(created[0]?.status, 'pending');
    assert.equal(created[0]?.orgId, 'org-a');
    assert.equal(created[0]?.roleKey, 'user');
  });

  test('no seat row at all means zero seats, not unlimited', async () => {
    const { d, created } = deps({ seats: {} });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'seats_exhausted' });
    assert.equal(created[0]?.status, 'pending');
  });

  test('a pending member keeps being denied on later logins, without a new row', async () => {
    const { d, created } = deps({ user: member({ status: 'pending' }), seats: ROOMY });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'seats_exhausted' });
    assert.equal(created.length, 0);
  });

  /**
   * Occupancy is counted per role, so moving somebody frees one seat and takes
   * another with no bookkeeping. Here `admin` is full while `user` has room —
   * the same person resolves or not purely on which role they hold.
   */
  test('occupancy is per role, which is what makes a role move free a seat', async () => {
    const full = { admin: { seats: 1, scopes: null }, user: { seats: 10, scopes: null } };

    const asAdmin = deps({ user: member({ roleKey: 'admin' }), seats: full, used: { admin: 1 } });
    const a = await resolveUser(IDENTITY, DEVICE, asAdmin.d);
    assert.equal(a.ok, true, 'an already-active admin is never evicted by a full role');

    const asUser = deps({ user: member({ roleKey: 'user' }), seats: full, used: { user: 1 } });
    const u = await resolveUser(IDENTITY, DEVICE, asUser.d);
    assert.equal(u.ok, true);
    if (u.ok) assert.equal(u.roleKey, 'user');
  });

  test('lowering seats below occupancy does not evict an active member', async () => {
    const { d } = deps({
      user: member(),
      seats: { user: { seats: 1, scopes: null } },
      used: { user: 9 },
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, true, 'seats gate new assignment, never an existing grant');
  });
});

/* ---------------- gates ---------------- */

describe('gates', () => {
  const active = { user: member(), seats: ROOMY };

  test('a suspended organisation denies', async () => {
    const { d } = deps({ ...active, org: { ...ORG_A, status: 'suspended' } });
    assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'org_suspended' });
  });

  test('a suspended licence denies', async () => {
    const { d } = deps({ ...active, license: { ...LICENSE, status: 'suspended' } });
    assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'license_suspended' });
  });

  test('end date is inclusive — a licence ending today still works', async () => {
    const { d } = deps({ ...active, today: '2026-12-31' });
    assert.equal((await resolveUser(IDENTITY, DEVICE, d)).ok, true);
  });

  test('the day after the end date denies', async () => {
    const { d } = deps({ ...active, today: '2027-01-01' });
    assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'license_expired' });
  });

  test('before the start date denies', async () => {
    const { d } = deps({ ...active, today: '2025-12-31' });
    assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'license_not_started' });
  });

  test('a disabled user denies', async () => {
    const { d } = deps({ ...active, user: member({ status: 'disabled' }) });
    assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'user_disabled' });
  });

  test('a disabled device denies', async () => {
    const { d } = deps({ ...active, device: { id: 'dev-1', status: 'disabled' } });
    assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'device_disabled' });
  });

  test('a stale device does not deny — staleness is analytics, not access', async () => {
    const { d } = deps({ ...active, device: { id: 'dev-1', status: 'stale' } });
    assert.equal((await resolveUser(IDENTITY, DEVICE, d)).ok, true);
  });
});

/* ---------------- the grant ---------------- */

describe('grant', () => {
  test('scopes come from the holder’s role', async () => {
    const { d } = deps({ user: member({ roleKey: 'admin' }), seats: ROOMY });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.scopes, [
        'cleanup', 'coordination', 'excel', 'general', 'parameters', 'troubleshoot',
      ]);
      assert.equal(r.roleKey, 'admin');
    }
  });

  test('a licence override wins over the role, never-gated still survives', async () => {
    const { d } = deps({
      user: member(),
      seats: { user: { seats: 10, scopes: ['excel'] } },
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.scopes, ['excel', 'general']);
  });

  /**
   * Deactivating a role stops new assignment. It must not sign out the people
   * already holding it — revoking working installs for a settings change is
   * exactly the interruption this system exists to avoid.
   */
  test('a deactivated role still resolves for members who already hold it', async () => {
    const { d } = deps({
      user: member(),
      roles: { user: { ...ROLE_USER, isActive: false } },
      seats: ROOMY,
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.scopes, ['cleanup', 'general']);
  });

  test('a role that no longer exists fails closed', async () => {
    const { d } = deps({ user: member({ roleKey: 'ghost' }), seats: ROOMY });
    assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'pending_approval' });
  });

  /**
   * Renaming a role is a display change. The key the token carries and the
   * scopes it grants are untouched — which is the whole argument for roles
   * being a table with an immutable key.
   */
  test('renaming a role changes nothing the add-in can observe', async () => {
    const before = deps({ user: member(), seats: ROOMY });
    const after = deps({
      user: member(),
      roles: { user: { ...ROLE_USER, name: 'Modeller' }, admin: ROLE_ADMIN },
      seats: ROOMY,
    });
    const a = await resolveUser(IDENTITY, DEVICE, before.d);
    const b = await resolveUser(IDENTITY, DEVICE, after.d);
    assert.equal(a.ok && b.ok, true);
    if (a.ok && b.ok) {
      assert.equal(a.roleKey, b.roleKey);
      assert.deepEqual(a.scopes, b.scopes);
    }
  });
});
