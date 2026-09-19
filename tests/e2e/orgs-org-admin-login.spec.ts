import { test, expect, request } from '@playwright/test';
import { API, createOrg, portalApi, stepUp, totp, unique } from './helpers/portal';

/**
 * An organisation admin's first sign-in, at the API: the password a portal
 * admin chose gets them exactly as far as enrolling an authenticator and
 * choosing their own password, and no further. Afterwards the old password
 * is dead.
 *
 * Driven through the endpoints rather than the pages so the contract holds
 * whatever the login screens look like; the browser side of the same journey
 * belongs to the portal specs.
 *
 * Its own email, so the login budget it spends is nobody else's. The
 * enrolment confirm and the login that follows share the TOTP secret, and a
 * confirmed code retires its own counter, so the spec waits for a fresh
 * window before the final login.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextWindow = () => sleep(30_000 - (Date.now() % 30_000) + 750);

test('first login: enrol, then a forced password change, then the portal', async () => {
  test.slow();
  const tag = unique();
  const owner = await portalApi('owner');
  const org = await createOrg(owner, { name: `E2E Org Admin ${tag}`, slug: `e2e-org-admin-${tag}` });

  const email = `org-admin-${tag}@example.test`;
  const firstPassword = `issued-by-portal-${tag}`;
  const ownPassword = `chosen-by-admin-${tag}`;

  /* ---- created by a portal admin, with both first-login flags ---- */

  // Creating an account is a step-up action. Proven unconditionally rather
  // than asserted on a refusal first: the owner context is shared across the
  // run and may still be inside a five-minute window from an earlier spec.
  await stepUp(owner, 'owner');
  const created = await owner.post(`${API}/admin/orgs/${org.id}/portal-users`, {
    data: { email, displayName: 'Priya Natarajan', password: firstPassword },
  });
  expect(created.status(), await created.text()).toBe(201);
  const row = ((await created.json()) as { row: { role: string; orgId: string; mustChangePassword: boolean; totpResetRequired: boolean } }).row;
  expect(row.role).toBe('org_admin');
  expect(row.orgId).toBe(org.id);
  expect(row.mustChangePassword).toBe(true);
  expect(row.totpResetRequired).toBe(true);

  // Listed on the organisation, and only there.
  const listed = await (await owner.get(`${API}/admin/orgs/${org.id}/portal-users`)).json() as { rows: { email: string }[] };
  expect(listed.rows.map((r) => r.email)).toEqual([email]);

  /* ---- 1. email + password, no code: enrolment ---- */

  const session = await request.newContext();
  const login = await session.post(`${API}/admin/auth/login`, { data: { email, password: firstPassword } });
  expect(login.status(), await login.text()).toBe(200);
  const first = await login.json() as { needsEnrol: boolean; next: string | null };
  expect(first.needsEnrol).toBe(true);
  expect(first.next).toBe('totp-enrol');

  // The enrolment cookie reaches nothing but enrolment.
  expect((await session.get(`${API}/admin/orgs`)).status()).toBe(401);

  const enrol = await session.post(`${API}/admin/auth/totp/enrol`);
  expect(enrol.status(), await enrol.text()).toBe(200);
  const { secret } = await enrol.json() as { secret: string };
  const confirm = await session.post(`${API}/admin/auth/totp/confirm`, { data: { totp: totp(secret) } });
  expect(confirm.status(), await confirm.text()).toBe(200);
  expect(((await confirm.json()) as { next: string | null }).next).toBe('password');

  /* ---- 2. a session, but gated until the password is theirs ---- */

  const gated = await session.get(`${API}/admin/orgs`);
  expect(gated.status()).toBe(403);
  expect(((await gated.json()) as { error: { code: string } }).error.code).toBe('password_change_required');

  const me = await (await session.get(`${API}/admin/auth/me`)).json() as {
    scope: string; orgId: string; orgName: string; mustChangePassword: boolean; capabilities: string[];
  };
  expect(me.mustChangePassword).toBe(true);
  expect(me.scope).toBe('org');
  expect(me.orgId).toBe(org.id);
  expect(me.orgName).toBe(org.name);

  const wrongCurrent = await session.post(`${API}/admin/auth/password`, {
    data: { currentPassword: 'not-the-password-at-all', newPassword: ownPassword },
  });
  expect(wrongCurrent.status(), 'a session alone must not be enough to set a password').toBe(401);

  const changed = await session.post(`${API}/admin/auth/password`, {
    data: { currentPassword: firstPassword, newPassword: ownPassword },
  });
  expect(changed.status(), await changed.text()).toBe(200);

  /* ---- 3. through, on the re-issued cookie ---- */

  const orgs = await session.get(`${API}/admin/orgs`);
  expect(orgs.status(), 'the caller stays signed in after the change').toBe(200);
  expect(((await orgs.json()) as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([org.id]);
  expect(((await (await session.get(`${API}/admin/auth/me`)).json()) as { mustChangePassword: boolean }).mustChangePassword).toBe(false);

  /* ---- 4. the password the portal admin knew is dead ---- */

  await nextWindow();
  const old = await request.newContext();
  const stale = await old.post(`${API}/admin/auth/login`, { data: { email, password: firstPassword, totp: totp(secret) } });
  expect(stale.status()).toBe(401);

  const fresh = await old.post(`${API}/admin/auth/login`, { data: { email, password: ownPassword, totp: totp(secret) } });
  expect(fresh.status(), await fresh.text()).toBe(200);
  expect(((await fresh.json()) as { next: string | null }).next).toBeNull();

  await session.dispose();
  await old.dispose();
});
