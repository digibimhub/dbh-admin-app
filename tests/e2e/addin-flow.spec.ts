import { test, expect, request } from '@playwright/test';

/**
 * The whole add-in lifecycle, against a running stack.
 *
 * Every step goes through the real endpoints: a real PKCE authorization-code
 * exchange (the mock issuer verifies the challenge itself), a real ES256
 * token, real seat arithmetic. Nothing is stubbed inside the API — only the
 * identity provider's URL differs, and the API refuses to boot in production
 * if it has been moved. See tests/mock-aps/server.mjs.
 *
 * The sign-in, refresh, TOTP and login helpers live in helpers/portal.ts, so
 * the portal specs share one login budget with this file rather than opening a
 * second one of their own.
 */

import { API, addinSignIn, portalApi, refresh, unique } from './helpers/portal';

/** The owner session this suite has always used, under its original name. */
const adminApi = () => portalApi('owner');

/* ========================================================== the flows ==== */

test.describe('add-in sign-in', () => {
  test('a person on a registered domain with a free seat is granted', async () => {
    const api = await request.newContext();
    const tag = unique();

    const grant = await addinSignIn(api, {
      sub: `ADSK_E2E_${tag}`,
      email: `e2e-${tag}@acme-eng.com`,
      name: 'E2E Person',
    }, `sha256:e2e-${tag}`);

    expect(grant.status).toBe('ok');
    if (grant.status !== 'ok') return;

    // The default role's scopes, plus the never-gated one.
    expect(grant.role).toBe('user');
    expect(grant.scopes).toContain('general');
    expect(grant.scopes).toContain('cleanup');
    // A scope this role does not grant must not appear.
    expect(grant.scopes).not.toContain('coordination');

    await api.dispose();
  });

  test('an unregistered domain is denied and never granted a token', async () => {
    const api = await request.newContext();
    const tag = unique();

    const grant = await addinSignIn(api, {
      sub: `ADSK_E2E_NOWHERE_${tag}`,
      email: `nobody-${tag}@not-registered-anywhere.test`,
    }, `sha256:e2e-nowhere-${tag}`);

    expect(grant.status).toBe('denied');
    if (grant.status !== 'denied') return;
    expect(grant.code).toBe('domain_not_registered');
    expect(grant).not.toHaveProperty('access_token');

    await api.dispose();
  });

  test('an unverified Autodesk email never reaches the domain lookup', async () => {
    const api = await request.newContext();
    const tag = unique();

    const grant = await addinSignIn(api, {
      sub: `ADSK_E2E_UNVERIFIED_${tag}`,
      email: `unverified-${tag}@acme-eng.com`,
      email_verified: false,
    }, `sha256:e2e-unverified-${tag}`);

    expect(grant.status).toBe('denied');
    if (grant.status !== 'denied') return;
    expect(grant.code).toBe('email_not_verified');

    await api.dispose();
  });
});

test.describe('refresh tokens', () => {
  test('rotates, and the rotated-away token still answers inside the replay window', async () => {
    const api = await request.newContext();
    const tag = unique();
    const device = `sha256:e2e-rotate-${tag}`;

    const first = await addinSignIn(api, {
      sub: `ADSK_E2E_ROT_${tag}`,
      email: `rotate-${tag}@acme-eng.com`,
    }, device);
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;

    const second = await refresh(api, first.refresh_token, device);
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.refresh_token).not.toBe(first.refresh_token);

    /**
     * The case that matters: the add-in sent a refresh, the reply was lost to
     * a dropped VPN, and it retries with the token it still holds. Strict
     * rotation would read that as theft and sign the user out mid-model. It
     * must succeed.
     */
    const retried = await refresh(api, first.refresh_token, device);
    expect(retried.status, 'a retry inside the replay window must not sign the user out').toBe('ok');

    // And the session is still alive afterwards.
    if (retried.status === 'ok') {
      const after = await refresh(api, retried.refresh_token, device);
      expect(after.status).toBe('ok');
    }

    await api.dispose();
  });

  test('an unknown refresh token is denied without touching the session', async () => {
    const api = await request.newContext();
    const tag = unique();
    const device = `sha256:e2e-unknown-${tag}`;

    const grant = await addinSignIn(api, {
      sub: `ADSK_E2E_UNK_${tag}`,
      email: `unknown-${tag}@acme-eng.com`,
    }, device);
    expect(grant.status).toBe('ok');
    if (grant.status !== 'ok') return;

    const bogus = await refresh(api, 'x'.repeat(64), device);
    expect(bogus.status).toBe('denied');

    // The real token still works: a wrong guess must not revoke anybody.
    const still = await refresh(api, grant.refresh_token, device);
    expect(still.status).toBe('ok');

    await api.dispose();
  });
});

test.describe('seats', () => {
  test('a full role holds the next person as pending, and a seat releases them', async () => {
    const api = await adminApi();
    const tag = unique();
    const device = `sha256:e2e-seat-${tag}`;

    // Byrne Structural is seeded at exactly its user-seat count.
    const orgsRes = await api.get(`${API}/admin/orgs?q=byrne`);
    const orgs = await orgsRes.json() as { rows: { id: string; slug: string }[] };
    const byrne = orgs.rows.find((o) => o.slug === 'byrne-structural');
    expect(byrne, 'seed is missing byrne-structural').toBeTruthy();

    const beforeRes = await api.get(`${API}/admin/orgs/${byrne!.id}`);
    const before = await beforeRes.json() as { seats: { roleKey: string; seats: number; used: number }[] };
    const userSeat = before.seats.find((s) => s.roleKey === 'user')!;
    expect(userSeat.used, 'the seed should leave the user role full').toBeGreaterThanOrEqual(userSeat.seats);

    /* ---- 1. sign in against a full role ---- */

    const denied = await addinSignIn(api, {
      sub: `ADSK_E2E_SEAT_${tag}`,
      email: `seat-${tag}@byrne-structural.com`,
      name: 'Seat Waiter',
    }, device);

    expect(denied.status).toBe('denied');
    if (denied.status !== 'denied') return;
    expect(denied.code).toBe('seats_exhausted');
    // A soft denial: it must read as "waiting", not "rejected".
    expect(denied.message.toLowerCase()).toContain('seat');

    /* ---- 2. they are a member all the same, just pending ---- */

    const peopleRes = await api.get(`${API}/admin/users?org=${byrne!.id}&status=pending`);
    const people = await peopleRes.json() as {
      rows: { user: { id: string; email: string; status: string; roleKey: string } }[];
    };
    const waiting = people.rows.find((r) => r.user.email === `seat-${tag}@byrne-structural.com`);
    expect(waiting, 'the person should exist as a pending member').toBeTruthy();
    expect(waiting!.user.roleKey).toBe('user');

    /* ---- 3. raise the seat count, then approve ---- */

    const licRes = await api.get(`${API}/admin/orgs/${byrne!.id}/license`);
    const lic = await licRes.json() as {
      license: { id: string };
      seats: { roleKey: string; seats: number }[];
    };
    const raised = lic.seats.map((s) => ({
      roleKey: s.roleKey,
      seats: s.roleKey === 'user' ? s.seats + 1 : s.seats,
    }));
    const patched = await api.patch(`${API}/admin/licenses/${lic.license.id}`, { data: { seats: raised } });
    expect(patched.status(), await patched.text()).toBe(200);

    const approved = await api.post(`${API}/admin/users/${waiting!.user.id}/approve`, { data: {} });
    expect(approved.status(), await approved.text()).toBe(200);

    /* ---- 4. they work at the next check, with no new sign-in ---- */

    const grant = await addinSignIn(api, {
      sub: `ADSK_E2E_SEAT_${tag}`,
      email: `seat-${tag}@byrne-structural.com`,
    }, device);
    expect(grant.status, 'a freed seat should grant at the next check').toBe('ok');

    /* ---- 5. a role move frees one seat and takes another ---- */

    if (grant.status === 'ok') {
      const moved = await api.post(`${API}/admin/users/${waiting!.user.id}/role`, {
        data: { roleKey: 'coordinator' },
      });
      expect(moved.status(), await moved.text()).toBe(200);

      const afterRes = await api.get(`${API}/admin/orgs/${byrne!.id}`);
      const after = await afterRes.json() as { seats: { roleKey: string; used: number }[] };
      const userAfter = after.seats.find((s) => s.roleKey === 'user')!;
      const coordAfter = after.seats.find((s) => s.roleKey === 'coordinator')!;

      expect(userAfter.used, 'the user seat should have been freed').toBe(userSeat.used);
      expect(coordAfter.used, 'the coordinator seat should now be taken').toBeGreaterThan(0);

      // And the scopes on the token follow the new role, without a sign-in.
      const rescoped = await refresh(api, grant.refresh_token, device);
      expect(rescoped.status).toBe('ok');
      if (rescoped.status === 'ok') {
        expect(rescoped.role).toBe('coordinator');
        expect(rescoped.scopes).toContain('coordination');
      }
    }

    /* ---- 6. put the seed back, so the suite is re-runnable ---- */

    // Without this the org is no longer full on the next run and this test's
    // own precondition fails. A suite that only passes once is not a suite.
    await api.post(`${API}/admin/users/${waiting!.user.id}/disable`, {
      data: { reason: 'e2e cleanup' },
    });
    const restored = await api.patch(`${API}/admin/licenses/${lic.license.id}`, {
      data: { seats: lic.seats.map((s) => ({ roleKey: s.roleKey, seats: s.seats })) },
    });
    expect(restored.status(), await restored.text()).toBe(200);
  });
});

test.describe('portal', () => {
  test('the organisation tabs render, and a row click navigates', async ({ page }) => {
    /**
     * The session comes from the login this suite already did, not a second
     * one through the form.
     *
     * Three real constraints make a UI login here a bad idea, and none of them
     * is a bug: an accepted TOTP code is recorded as spent on the portal user
     * row, that row is shared by every API instance, and logins are rate
     * limited five per fifteen minutes per email against an in-memory counter
     * that only a restart clears. A suite that burns logins to reach the
     * screens it actually wants to assert on is a suite that fails for reasons
     * unrelated to the code under test.
     *
     * The cookie is a JWT signed with the shared portal secret, so the one
     * minted by the E2E API is accepted by the portal's API too.
     */
    const api = await adminApi();
    const { cookies } = await api.storageState();
    const session = cookies.find((c) => c.name === 'portal_session');
    expect(session, 'no portal session cookie to reuse').toBeTruthy();
    await page.context().addCookies([{ ...session!, domain: 'localhost', path: '/' }]);

    await page.goto('/orgs');
    await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();

    // A row click navigates. There is no drawer to intercept it.
    await page.getByText('Byrne Structural').first().click();
    await page.waitForURL(/\/orgs\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    // Scoped to the tab strip: "Domains" also appears as a body link further
    // down the Overview tab, and getByRole matches an accessible name by
    // substring, so an unscoped locator resolves to two elements.
    const tabs = page.getByRole('navigation', { name: 'Section' });
    await expect(tabs.getByRole('link', { name: 'Domains' })).toBeVisible();

    await tabs.getByRole('link', { name: 'Licence' }).click();
    await expect(page.getByRole('heading', { name: 'Seats' })).toBeVisible();
    // Seats are shown as used/total per role, which is the point of the tab.
    await expect(page.getByRole('columnheader', { name: 'Used' })).toBeVisible();

    await tabs.getByRole('link', { name: 'People' }).click();
    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible();

    await tabs.getByRole('link', { name: 'Domains' }).click();
    await expect(page.getByRole('heading', { name: 'Registered domains' })).toBeVisible();
    await expect(page.getByText('byrne-structural.com')).toBeVisible();
  });

  test('renaming a role changes the display name and nothing the add-in reads', async () => {
    const api = await adminApi();
    const tag = unique();
    const device = `sha256:e2e-rename-${tag}`;

    const before = await addinSignIn(api, {
      sub: `ADSK_E2E_RENAME_${tag}`,
      email: `rename-${tag}@acme-eng.com`,
    }, device);
    expect(before.status).toBe('ok');
    if (before.status !== 'ok') return;

    const renamed = await api.patch(`${API}/admin/roles/${before.role}`, {
      data: { name: `Renamed ${tag}` },
    });
    expect(renamed.status(), await renamed.text()).toBe(200);

    const after = await refresh(api, before.refresh_token, device);
    expect(after.status).toBe('ok');
    if (after.status !== 'ok') return;

    // The contract with the DLL is the key and the scopes. Neither moved.
    expect(after.role).toBe(before.role);
    expect(after.scopes).toEqual(before.scopes);

    // Put the name back so the suite is re-runnable.
    await api.patch(`${API}/admin/roles/${before.role}`, { data: { name: 'User' } });
  });
});
