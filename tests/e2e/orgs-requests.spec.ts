import { test, expect, request, type APIRequestContext } from '@playwright/test';
import {
  API, addinSignIn, createOrg, portalApi, refresh, stepUp, unique, type Grant,
} from './helpers/portal';

/**
 * The join queue, end to end: no licence, then a licence (auto-assign), then
 * approval policy with approve / reject / re-open / delete, the seat and
 * suspension 409s, and the policy flip. Every sign-in is the real PKCE flow
 * against the mock issuer; nothing inside the API is stubbed.
 *
 * Serial and stateful on purpose: one organisation is walked through every
 * state it can be in, which is cheaper on the login and TOTP budgets than a
 * fresh organisation per assertion. The owner's step-ups each wait for a new
 * 30-second window, so the tests that need one are marked slow.
 */

test.describe.configure({ mode: 'serial' });

const tag = unique();
const DOMAIN = `req-${tag}.example`;
const person = (name: string) => ({
  sub: `ADSK_E2E_REQ_${name.toUpperCase()}_${tag}`,
  email: `${name}-${tag}@${DOMAIN}`,
  name: `Requests ${name}`,
});
const device = (name: string) => `sha256:e2e-req-${name}-${tag}`;

const today = () => new Date().toISOString().slice(0, 10);
const nextYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

interface QueueRow {
  user: {
    id: string; email: string; status: string; pendingReason: string | null;
    attemptCount: number; lastAttemptAt: string | null; reviewNote: string | null;
  };
  roleName: string;
  reviewedByEmail: string | null;
}
interface Queue {
  rows: QueueRow[];
  counts: { awaitingApproval: number; seatsExhausted: number; noLicence: number; rejected: number };
  licence: { active: boolean; endDate: string | null };
  seats: { roleKey: string; seats: number; used: number; free: number }[];
}

let owner: APIRequestContext;
let addin: APIRequestContext;
let orgId = '';
let licenseId = '';

async function queue(status: 'pending' | 'rejected' = 'pending'): Promise<Queue> {
  const res = await owner.get(`${API}/admin/orgs/${orgId}/requests?status=${status}`);
  expect(res.status(), await res.text()).toBe(200);
  return await res.json() as Queue;
}

async function rowFor(email: string, status: 'pending' | 'rejected' = 'pending'): Promise<QueueRow> {
  const row = (await queue(status)).rows.find((r) => r.user.email === email);
  expect(row, `${email} should be on the ${status} tab`).toBeTruthy();
  return row!;
}

async function setUserSeats(n: number): Promise<void> {
  const res = await owner.patch(`${API}/admin/licenses/${licenseId}`, {
    data: { seats: [{ roleKey: 'user', seats: n }, { roleKey: 'coordinator', seats: 1 }] },
  });
  expect(res.status(), await res.text()).toBe(200);
}

const denied = (g: Grant) => (g.status === 'denied' ? g.code : `granted as ${g.role}`);

test.beforeAll(async () => {
  owner = await portalApi('owner');
  addin = await request.newContext();
  const org = await createOrg(owner, { name: `E2E Requests ${tag}`, slug: `e2e-requests-${tag}` });
  orgId = org.id;
  const dom = await owner.post(`${API}/admin/orgs/${orgId}/domains`, { data: { value: DOMAIN } });
  expect(dom.status(), await dom.text()).toBe(201);
});

test.afterAll(async () => {
  await addin.dispose();
});

test('with no licence, a sign-in becomes a waiting member of the org, not a global request', async () => {
  const z = person('zed');
  const grant = await addinSignIn(addin, z, device('zed'));
  expect(denied(grant)).toBe('license_missing');
  expect(grant).not.toHaveProperty('access_token');

  const row = await rowFor(z.email);
  expect(row.user.status).toBe('pending');
  expect(row.user.pendingReason).toBe('no_licence');
  expect(row.user.attemptCount).toBe(1);
  expect(row.roleName).toBe('User');

  const q = await queue();
  expect(q.counts.noLicence).toBe(1);
  expect(q.licence.active).toBe(false);

  // And NOT in the global queue: the organisation is known.
  const global = await (await owner.get(`${API}/admin/access-requests?q=${z.email}`)).json() as { rows: { email: string }[] };
  expect(global.rows.find((r) => r.email === z.email)).toBeUndefined();

  // The org page carries the same count.
  const detail = await (await owner.get(`${API}/admin/orgs/${orgId}`)).json() as { counts: { noLicence: number; pending: number } };
  expect(detail.counts.noLicence).toBe(1);
  expect(detail.counts.pending).toBe(1);
});

test('once a licence with a free seat is issued, the next sign-in is seated with no approval', async () => {
  const lic = await owner.post(`${API}/admin/orgs/${orgId}/license`, {
    data: {
      mode: 'standard', startDate: today(), endDate: nextYear(), graceDays: 7,
      seats: [{ roleKey: 'user', seats: 4 }, { roleKey: 'coordinator', seats: 1 }],
    },
  });
  expect(lic.status(), await lic.text()).toBe(201);
  licenseId = ((await lic.json()) as { row: { id: string } }).row.id;

  const z = person('zed');
  const grant = await addinSignIn(addin, z, device('zed'));
  expect(denied(grant)).toBe('granted as user');

  expect((await queue()).rows.find((r) => r.user.email === z.email)).toBeUndefined();
  const detail = await (await owner.get(`${API}/admin/orgs/${orgId}`)).json() as { seats: { roleKey: string; used: number }[] };
  expect(detail.seats.find((s) => s.roleKey === 'user')!.used).toBe(1);

  // The promotion is audited with the add-in as the actor: nobody clicked.
  const audit = await (await owner.get(`${API}/admin/audit-log?org=${orgId}&action=user.auto_activate`)).json() as { total: number };
  expect(audit.total).toBe(1);
});

test('under approval policy a newcomer waits, is counted on every try, and gets no token', async () => {
  const policy = await owner.patch(`${API}/admin/orgs/${orgId}`, { data: { joinPolicy: 'approval' } });
  expect(policy.status(), await policy.text()).toBe(200);
  expect(((await policy.json()) as { row: { joinPolicy: string } }).row.joinPolicy).toBe('approval');

  const a = person('alpha');
  const first = await addinSignIn(addin, a, device('alpha'));
  expect(denied(first)).toBe('awaiting_approval');
  expect(first).not.toHaveProperty('access_token');

  const second = await addinSignIn(addin, a, device('alpha'));
  expect(denied(second)).toBe('awaiting_approval');

  const row = await rowFor(a.email);
  expect(row.user.pendingReason).toBe('awaiting_approval');
  expect(row.user.attemptCount).toBe(2);
  expect(row.user.lastAttemptAt).toBeTruthy();
  expect((await queue()).counts.awaitingApproval).toBe(1);

  // A free seat is not an approval.
  const detail = await (await owner.get(`${API}/admin/orgs/${orgId}`)).json() as { seats: { roleKey: string; used: number }[] };
  expect(detail.seats.find((s) => s.roleKey === 'user')!.used).toBe(1);
});

test('approve seats them; the next sign-in and the refresh after it both succeed', async () => {
  const a = person('alpha');
  const row = await rowFor(a.email);

  const approved = await owner.post(`${API}/admin/users/${row.user.id}/approve`, { data: {} });
  expect(approved.status(), await approved.text()).toBe(200);
  const after = ((await approved.json()) as { row: { status: string; pendingReason: string | null; reviewedBy: string | null } }).row;
  expect(after.status).toBe('active');
  expect(after.pendingReason).toBeNull();
  expect(after.reviewedBy).toBeTruthy();

  const grant = await addinSignIn(addin, a, device('alpha'));
  expect(denied(grant)).toBe('granted as user');
  if (grant.status !== 'ok') return;
  const again = await refresh(addin, grant.refresh_token, device('alpha'));
  expect(again.status).toBe('ok');
});

test('a mass-assigned status on PATCH is ignored — status moves only through its own routes', async () => {
  const b = person('bravo');
  expect(denied(await addinSignIn(addin, b, device('bravo')))).toBe('awaiting_approval');
  const row = await rowFor(b.email);

  const patched = await owner.patch(`${API}/admin/users/${row.user.id}`, { data: { status: 'active' } });
  expect(patched.status(), await patched.text()).toBe(200);
  expect(((await patched.json()) as { row: { status: string } }).row.status).toBe('pending');
});

test('reject is sticky: the next sign-in says so, and nothing new is queued', async () => {
  const b = person('bravo');
  const row = await rowFor(b.email);

  const rejected = await owner.post(`${API}/admin/users/${row.user.id}/reject`, {
    data: { reason: 'Contractor, not on the account' },
  });
  expect(rejected.status(), await rejected.text()).toBe(200);

  const grant = await addinSignIn(addin, b, device('bravo'));
  expect(denied(grant)).toBe('membership_rejected');
  expect(grant).not.toHaveProperty('access_token');

  expect((await queue()).rows.find((r) => r.user.email === b.email)).toBeUndefined();
  const gone = await rowFor(b.email, 'rejected');
  expect(gone.user.reviewNote).toBe('Contractor, not on the account');
  expect(gone.reviewedByEmail).toBe('admin@yourco.local');
  expect(gone.user.attemptCount).toBe(2);
  expect((await queue('rejected')).counts.rejected).toBe(1);
});

test('approve re-opens a rejection', async () => {
  const b = person('bravo');
  const row = await rowFor(b.email, 'rejected');
  const approved = await owner.post(`${API}/admin/users/${row.user.id}/approve`, { data: {} });
  expect(approved.status(), await approved.text()).toBe(200);
  expect(denied(await addinSignIn(addin, b, device('bravo')))).toBe('granted as user');
});

test('delete forgets the request, so signing in again starts a fresh one', async () => {
  test.slow();
  const c = person('charlie');
  expect(denied(await addinSignIn(addin, c, device('charlie')))).toBe('awaiting_approval');
  const before = await rowFor(c.email);

  // Step-up: the one member action the portal cannot undo. (Not asserted as
  // a 403 first — the shared owner context may still be inside a step-up
  // window from an earlier spec.)
  await stepUp(owner, 'owner');
  const deleted = await owner.delete(`${API}/admin/users/${before.user.id}`, { data: { reason: 'wrong person' } });
  expect(deleted.status(), await deleted.text()).toBe(200);

  expect(denied(await addinSignIn(addin, c, device('charlie')))).toBe('awaiting_approval');
  const after = await rowFor(c.email);
  expect(after.user.id).not.toBe(before.user.id);
  expect(after.user.attemptCount).toBe(1);

  // An active member cannot be deleted, only disabled.
  const z = await (await owner.get(`${API}/admin/users?org=${orgId}&q=zed-`)).json() as { rows: { user: { id: string } }[] };
  const keep = await owner.delete(`${API}/admin/users/${z.rows[0]!.user.id}`, { data: { reason: 'they were a real member' } });
  expect(keep.status()).toBe(409);
});

test('approve needs a seat: a full role is a 409 that names it', async () => {
  const c = person('charlie');
  const row = await rowFor(c.email);
  await setUserSeats(0);

  const refused = await owner.post(`${API}/admin/users/${row.user.id}/approve`, { data: {} });
  expect(refused.status()).toBe(409);
  expect((await refused.text()).toLowerCase()).toContain('seat');

  // The queue response says so before anybody clicks.
  const q = await queue();
  expect(q.seats.find((s) => s.roleKey === 'user')!.free).toBe(0);
  await setUserSeats(10);
});

test('flipping back to automatic leaves an awaiting row waiting, but a seat wait gets in by itself', async () => {
  const policy = await owner.patch(`${API}/admin/orgs/${orgId}`, { data: { joinPolicy: 'automatic' } });
  expect(policy.status(), await policy.text()).toBe(200);

  // Charlie was told to wait for a decision; a free seat under `automatic`
  // does not stand in for one.
  const c = person('charlie');
  expect(denied(await addinSignIn(addin, c, device('charlie')))).toBe('awaiting_approval');
  expect((await rowFor(c.email)).user.pendingReason).toBe('awaiting_approval');

  // Delta arrives while the role is full, waits on a seat, and is promoted
  // at the next sign-in once the count is raised — no approval involved.
  const used = (await queue()).seats.find((s) => s.roleKey === 'user')!.used;
  await setUserSeats(used);
  const d = person('delta');
  expect(denied(await addinSignIn(addin, d, device('delta')))).toBe('seats_exhausted');
  expect((await rowFor(d.email)).user.pendingReason).toBe('seats_exhausted');

  await setUserSeats(used + 1);
  expect(denied(await addinSignIn(addin, d, device('delta')))).toBe('granted as user');
  expect((await queue()).rows.find((r) => r.user.email === d.email)).toBeUndefined();
});

test.describe('as the seeded organisation admin, against DigiBIM Internal', () => {
  let internalId = '';
  let newHireId = '';
  let ownerCtx: APIRequestContext;

  test.beforeAll(async () => {
    ownerCtx = await portalApi('owner');
    const orgs = await (await ownerCtx.get(`${API}/admin/orgs?q=digibim`)).json() as { rows: { id: string; slug: string }[] };
    internalId = orgs.rows.find((o) => o.slug === 'digibim-internal')!.id;
  });

  test('the seeded queue is theirs to read, and the seeded denials hold', async () => {
    const admin = await portalApi('orgAdmin');
    const q = await (await admin.get(`${API}/admin/orgs/${internalId}/requests`)).json() as Queue;
    const newHire = q.rows.find((r) => r.user.email === 'newhire@digibimhub.com');
    expect(newHire?.user.pendingReason).toBe('awaiting_approval');
    newHireId = newHire!.user.id;
    expect(q.counts.rejected).toBe(1);

    const api = await request.newContext();
    const hire = await addinSignIn(api, { sub: 'ADSK_DBH_NEWHIRE', email: 'newhire@digibimhub.com' }, `sha256:e2e-newhire-${tag}`);
    expect(denied(hire)).toBe('awaiting_approval');
    const contractor = await addinSignIn(api, { sub: 'ADSK_DBH_CONTRACTOR', email: 'contractor@digibimhub.com' }, `sha256:e2e-contractor-${tag}`);
    expect(denied(contractor)).toBe('membership_rejected');
    await api.dispose();
  });

  test('a suspended organisation is read-only for its admin: approve is a 409', async () => {
    test.slow();
    await stepUp(ownerCtx, 'owner');
    const suspended = await ownerCtx.post(`${API}/admin/orgs/${internalId}/suspend`, { data: { reason: 'e2e: read-only check' } });
    expect(suspended.status(), await suspended.text()).toBe(200);

    try {
      const admin = await portalApi('orgAdmin');
      const read = await admin.get(`${API}/admin/orgs/${internalId}/requests`);
      expect(read.status(), 'reads still work while suspended').toBe(200);
      const approve = await admin.post(`${API}/admin/users/${newHireId}/approve`, { data: {} });
      expect(approve.status(), await approve.text()).toBe(409);
      const me = await (await admin.get(`${API}/admin/auth/me`)).json() as { orgStatus: string };
      expect(me.orgStatus).toBe('suspended');
    } finally {
      const back = await ownerCtx.post(`${API}/admin/orgs/${internalId}/reactivate`);
      expect(back.status(), await back.text()).toBe(200);
    }
  });

  test('the admin can approve their own queue, and the row records who did it', async () => {
    // A fresh person rather than the seeded new hire, so the seed's queue is
    // left exactly as `pnpm verify:resolver` expects to find it.
    const api = await request.newContext();
    const hire = { sub: `ADSK_E2E_HIRE_${tag}`, email: `hire-${tag}@digibimhub.com`, name: 'Second Hire' };
    expect(denied(await addinSignIn(api, hire, `sha256:e2e-hire-${tag}`))).toBe('awaiting_approval');

    const admin = await portalApi('orgAdmin');
    const q = await (await admin.get(`${API}/admin/orgs/${internalId}/requests`)).json() as Queue;
    const row = q.rows.find((r) => r.user.email === hire.email);
    expect(row).toBeTruthy();

    const approved = await admin.post(`${API}/admin/users/${row!.user.id}/approve`, { data: {} });
    expect(approved.status(), await approved.text()).toBe(200);
    const after = ((await approved.json()) as { row: { status: string; reviewedBy: string | null } }).row;
    expect(after.status).toBe('active');
    expect(after.reviewedBy).toBeTruthy();

    // An approved member cannot be rejected — that is what disable is for.
    const rejected = await admin.post(`${API}/admin/users/${row!.user.id}/reject`, { data: { reason: 'too late' } });
    expect(rejected.status()).toBe(400);

    expect(denied(await addinSignIn(api, hire, `sha256:e2e-hire-${tag}`))).toBe('granted as user');
    await api.dispose();

    // Occupancy back where the seed left it.
    const disabled = await admin.post(`${API}/admin/users/${row!.user.id}/disable`, { data: { reason: 'e2e cleanup' } });
    expect(disabled.status(), await disabled.text()).toBe(200);
  });
});
