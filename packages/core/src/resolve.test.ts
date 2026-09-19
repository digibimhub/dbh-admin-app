import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveUser, emailDomain, offlineGraceExceeded, resolveScopes,
  type ResolveDeps, type OrgRow, type LicenseRow, type UserRow, type RoleRow,
  type SeatRow, type AutodeskIdentity, type DeviceInfo,
} from './resolve.ts';

/* ---------------- fixtures ---------------- */

const ORG_A: OrgRow = { id: 'org-a', name: 'Acme Engineering', status: 'active', joinPolicy: 'automatic' };
const ORG_APPROVAL: OrgRow = { ...ORG_A, joinPolicy: 'approval' };

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
  const activated: string[] = [];
  const attempts: { userId: string; reason: string | undefined }[] = [];
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
      return {
        id: 'new-user', orgId: input.orgId, roleKey: input.roleKey,
        status: input.status, pendingReason: input.pendingReason,
      };
    },
    activateUser: async (id) => { activated.push(id); },
    recordAttempt: async (userId, reason) => { attempts.push({ userId, reason }); },
    upsertAccessRequest: async (r) => { requests.push(r); },
    today: () => o.today ?? '2026-06-15',
  };
  return { d, requests, created, activated, attempts };
}

const member = (p: Partial<UserRow> = {}): UserRow => ({
  id: 'u1', orgId: 'org-a', roleKey: 'user', status: 'active', pendingReason: null, ...p,
});

/** A member held on a seat, the way the resolver itself would have written them. */
const waitingForSeat = (p: Partial<UserRow> = {}): UserRow =>
  member({ status: 'pending', pendingReason: 'seats_exhausted', ...p });

/** One `user` seat, already taken: the role is full. */
const FULL: Record<string, SeatRow> = { user: { seats: 1, scopes: null } };

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

  /**
   * Changed with the join queue. A registered domain with no licence used to
   * become a global access request, which the organisation could not see. The
   * person now waits as a member of the right organisation, so the org admin
   * and the org page show them and they are seated the moment a licence lands.
   */
  test('no active licence makes them a waiting member of the org, not a global request', async () => {
    const { d, created, requests } = deps({ license: null });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'license_missing' });
    assert.equal(created.length, 1);
    assert.equal(created[0]?.orgId, 'org-a');
    assert.equal(created[0]?.status, 'pending');
    assert.equal(created[0]?.pendingReason, 'no_licence');
    assert.equal(requests.length, 0, 'the organisation is known, so nothing goes to the global queue');
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
    assert.equal(created[0]?.pendingReason, 'seats_exhausted');
    assert.equal(created[0]?.orgId, 'org-a');
    assert.equal(created[0]?.roleKey, 'user');
  });

  test('a seated member is written with no pending reason', async () => {
    const { d, created } = deps({ seats: ROOMY });
    assert.equal((await resolveUser(IDENTITY, DEVICE, d)).ok, true);
    assert.equal(created[0]?.pendingReason, null);
  });

  test('no seat row at all means zero seats, not unlimited', async () => {
    const { d, created } = deps({ seats: {} });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'seats_exhausted' });
    assert.equal(created[0]?.status, 'pending');
  });

  test('a pending member with still no seat keeps being denied, without a new row', async () => {
    const { d, created, attempts, activated } = deps({
      user: waitingForSeat(), seats: FULL, used: { user: 1 },
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'seats_exhausted' });
    assert.equal(created.length, 0);
    assert.equal(activated.length, 0);
    // Counted, so the queue can show how often they have tried.
    assert.deepEqual(attempts, [{ userId: 'u1', reason: 'seats_exhausted' }]);
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

/* ---------------- join policy and the queue ---------------- */

describe('join policy: approval', () => {
  test('a newcomer waits for approval even with a free seat, and takes none', async () => {
    const { d, created, requests, activated } = deps({ domainOrg: ORG_APPROVAL, org: ORG_APPROVAL, seats: ROOMY });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'awaiting_approval' });
    assert.equal(created.length, 1);
    assert.equal(created[0]?.status, 'pending');
    assert.equal(created[0]?.pendingReason, 'awaiting_approval');
    assert.equal(created[0]?.orgId, 'org-a');
    // Not a seat: occupancy is a count of ACTIVE rows, and this one is not.
    assert.equal(activated.length, 0);
    // Not a global request either: the organisation is known.
    assert.equal(requests.length, 0);
  });

  test('a known awaiting row keeps being denied and bumps the attempt', async () => {
    const { d, created, activated, attempts } = deps({
      user: member({ status: 'pending', pendingReason: 'awaiting_approval' }),
      org: ORG_APPROVAL, seats: ROOMY,
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'awaiting_approval' });
    assert.equal(created.length, 0);
    assert.equal(activated.length, 0, 'a free seat must not stand in for an approval');
    assert.deepEqual(attempts, [{ userId: 'u1', reason: 'awaiting_approval' }]);
  });

  /**
   * Policy flips. A row created under `approval` was told to wait for a
   * decision; flipping to `automatic` later does not unmake that. In the
   * other direction, a seat wait stops promoting itself the moment the
   * organisation asks for approvals.
   */
  test('an awaiting row is never auto-promoted, even after the policy flips to automatic', async () => {
    const { d, activated } = deps({
      user: member({ status: 'pending', pendingReason: 'awaiting_approval' }),
      org: ORG_A, seats: ROOMY,
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'awaiting_approval' });
    assert.equal(activated.length, 0);
  });

  test('under approval a seat wait stops auto-promoting, and a free seat changes nothing', async () => {
    const { d, activated, attempts } = deps({ user: waitingForSeat(), org: ORG_APPROVAL, seats: ROOMY });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'seats_exhausted' });
    assert.equal(activated.length, 0);
    assert.deepEqual(attempts, [{ userId: 'u1', reason: 'seats_exhausted' }]);
  });

  test('an unlicensed org under approval still holds newcomers with no_licence', async () => {
    const { d, created } = deps({ domainOrg: ORG_APPROVAL, org: ORG_APPROVAL, license: null });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'license_missing' });
    assert.equal(created[0]?.pendingReason, 'no_licence');
  });

  test('a no_licence row stays waiting under approval once a licence exists', async () => {
    const { d, activated, attempts } = deps({
      user: member({ status: 'pending', pendingReason: 'no_licence' }),
      org: ORG_APPROVAL, seats: ROOMY,
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, false);
    assert.equal(activated.length, 0);
    // The licence is there now, so what they are waiting on is a decision
    // about a seat — the reason is refreshed rather than left stale.
    assert.equal(attempts[0]?.reason, 'seats_exhausted');
  });
});

describe('join policy: automatic — the auto-assign rule', () => {
  test('a seat wait is promoted at the next sign-in once a seat is free', async () => {
    const { d, activated, attempts, created } = deps({
      user: waitingForSeat(), seats: FULL, used: { user: 0 },
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.tier, 1, 'a known row, promoted — not a fresh provision');
      assert.equal(r.source, 'existing');
      assert.equal(r.userId, 'u1');
      assert.deepEqual(r.scopes, ['cleanup', 'general']);
    }
    assert.deepEqual(activated, ['u1']);
    assert.equal(attempts.length, 0, 'a grant is not a failed attempt');
    assert.equal(created.length, 0);
  });

  test('a no_licence wait is promoted once a licence with a free seat is issued', async () => {
    const { d, activated } = deps({
      user: member({ status: 'pending', pendingReason: 'no_licence' }), seats: ROOMY,
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(r.ok, true);
    assert.deepEqual(activated, ['u1']);
  });

  test('a no_licence wait becomes a seat wait when the licence has no room', async () => {
    const { d, activated, attempts } = deps({
      user: member({ status: 'pending', pendingReason: 'no_licence' }), seats: FULL, used: { user: 1 },
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'seats_exhausted' });
    assert.equal(activated.length, 0);
    assert.deepEqual(attempts, [{ userId: 'u1', reason: 'seats_exhausted' }]);
  });

  test('while the org has no licence a waiting member is held with no_licence', async () => {
    const { d, activated, attempts } = deps({ user: waitingForSeat(), license: null });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'license_missing' });
    assert.equal(activated.length, 0);
    // Refreshed: they were waiting on a seat, now they are waiting on a licence.
    assert.deepEqual(attempts, [{ userId: 'u1', reason: 'no_licence' }]);
  });

  test('a licence lapse does not turn an awaiting row into a licence wait', async () => {
    const { d, attempts } = deps({
      user: member({ status: 'pending', pendingReason: 'awaiting_approval' }), license: null,
    });
    await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(attempts[0]?.reason, 'awaiting_approval');
  });

  test('promotion runs the same gates as any other grant', async () => {
    const { d, activated } = deps({
      user: waitingForSeat(), seats: ROOMY, device: { id: 'dev-1', status: 'disabled' },
    });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'device_disabled' });
    // The seat was taken — the person is a member now — but the machine is
    // still blocked. That is the existing rule for active members too.
    assert.deepEqual(activated, ['u1']);
  });

  /**
   * The accepted race. Two waiting members sign in at the same instant with
   * one seat free: both count 0 used, both activate. The window is identical
   * to first-sign-in provisioning today, the outcome is one role over-cap
   * (visible on the Licence tab), and nobody is evicted — seats gate becoming
   * active and never revisit a grant. Documented here so it is a choice, not
   * a surprise.
   */
  test('the count and the activation are separate steps (the documented race)', async () => {
    let used = 0;
    const { d, activated } = deps({ user: waitingForSeat(), seats: FULL });
    d.countActiveInRole = async () => used;
    d.activateUser = async (id) => { activated.push(id); used += 1; };
    const first = await resolveUser(IDENTITY, DEVICE, d);
    const second = await resolveUser(IDENTITY, DEVICE, d);
    assert.equal(first.ok, true);
    assert.deepEqual(second, { ok: false, code: 'seats_exhausted' });
    assert.equal(activated.length, 1);
  });
});

describe('rejected members', () => {
  test('a rejected member is denied membership_rejected and the attempt is counted', async () => {
    const { d, created, activated, attempts } = deps({ user: member({ status: 'rejected' }), seats: ROOMY });
    const r = await resolveUser(IDENTITY, DEVICE, d);
    assert.deepEqual(r, { ok: false, code: 'membership_rejected' });
    assert.equal(created.length, 0, 'no new row: the decision is sticky');
    assert.equal(activated.length, 0, 'a free seat does not override a rejection');
    // No reason: a rejected row must keep pending_reason null.
    assert.deepEqual(attempts, [{ userId: 'u1', reason: undefined }]);
  });

  test('a rejected member is not auto-promoted whatever the policy', async () => {
    for (const org of [ORG_A, ORG_APPROVAL]) {
      const { d, activated } = deps({ user: member({ status: 'rejected' }), org, seats: ROOMY });
      const r = await resolveUser(IDENTITY, DEVICE, d);
      assert.equal(r.ok, false);
      assert.equal(activated.length, 0);
    }
  });
});

describe('gate order for waiting and rejected members', () => {
  test('a suspended organisation is reported before the membership state', async () => {
    for (const user of [waitingForSeat(), member({ status: 'rejected' })]) {
      const { d, attempts } = deps({ user, org: { ...ORG_A, status: 'suspended' }, seats: ROOMY });
      assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'org_suspended' });
      assert.equal(attempts.length, 0, 'a suspension is not this person doing anything');
    }
  });

  test('a disabled member is reported before a rejection could be', async () => {
    const { d } = deps({ user: member({ status: 'disabled' }), seats: ROOMY });
    assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'user_disabled' });
  });

  test('an expired licence holds a waiting member on the licence, not the seat', async () => {
    const { d, attempts } = deps({ user: waitingForSeat(), seats: ROOMY, today: '2027-01-01' });
    assert.deepEqual(await resolveUser(IDENTITY, DEVICE, d), { ok: false, code: 'license_expired' });
    assert.deepEqual(attempts, [{ userId: 'u1', reason: 'no_licence' }]);
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
