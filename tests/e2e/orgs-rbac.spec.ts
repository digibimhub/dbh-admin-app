import { test, expect } from '@playwright/test';
import { API, createOrg, portalApi, unique, type PortalRoleName } from './helpers/portal';

/**
 * Every seeded role against every capability, at the real routes.
 *
 * The admin app keeps its own copy of the capability matrix so the browser
 * bundle does not have to carry zod, and the API enforces the copy in
 * `@app/shared`. Two copies drift. This is what catches it: it does not read
 * either table, it asks the routes.
 *
 * Each probe sends a deliberately invalid body. `requireCapability` runs before
 * the handler, so a role that lacks the capability is refused before anything
 * is parsed — and a role that has it gets a 400 instead, which is the answer
 * this file is looking for. Nothing is created, changed or deleted.
 *
 * The organisation admin is in the loop too, and is the first role for which
 * READS are not open: the second half of this file walks the scope layer,
 * which answers 404 for another organisation's ids (so they cannot be
 * confirmed by probing) and 403 for the surfaces that are portal staff's.
 */

const ANY_UUID = '00000000-0000-4000-8000-000000000000';

/** Which roles the matrix says may do each of these. */
const EXPECTED: Record<string, PortalRoleName[]> = {
  'org.create': ['owner'],
  'org.edit': ['owner'],
  'org.suspend': ['owner'],
  'domain.manage': ['owner'],
  'license.manage': ['owner'],
  'user.manage': ['owner'],
  'user.import': ['owner'],
  'device.manage': ['owner', 'support'],
  'request.review': ['owner', 'support'],
  'panel.manage': ['owner'],
  'role.manage': ['owner'],
  'portal_user.manage': ['owner'],
  'member.review': ['owner', 'orgAdmin'],
  'member.manage': ['owner', 'orgAdmin'],
  'org_admin.manage': ['owner'],
};

let orgId = '';

test.beforeAll(async () => {
  const api = await portalApi('owner');
  const org = await createOrg(api, { name: `E2E RBAC ${unique()}`, slug: `e2e-rbac-${unique()}` });
  orgId = org.id;
});

function probes(): { capability: string; method: 'post' | 'patch' | 'delete'; path: string }[] {
  return [
    { capability: 'org.create', method: 'post', path: '/admin/orgs' },
    { capability: 'org.edit', method: 'patch', path: `/admin/orgs/${orgId}` },
    { capability: 'org.suspend', method: 'post', path: `/admin/orgs/${orgId}/suspend` },
    { capability: 'domain.manage', method: 'post', path: `/admin/orgs/${orgId}/domains` },
    { capability: 'domain.manage', method: 'delete', path: `/admin/domains/${ANY_UUID}` },
    { capability: 'license.manage', method: 'post', path: `/admin/orgs/${orgId}/license` },
    { capability: 'license.manage', method: 'patch', path: `/admin/licenses/${ANY_UUID}` },
    { capability: 'user.manage', method: 'post', path: '/admin/users' },
    { capability: 'user.manage', method: 'patch', path: `/admin/users/${ANY_UUID}` },
    { capability: 'user.import', method: 'post', path: '/admin/users/import/preview' },
    { capability: 'member.manage', method: 'post', path: `/admin/users/${ANY_UUID}/disable` },
    { capability: 'member.manage', method: 'post', path: `/admin/users/${ANY_UUID}/role` },
    { capability: 'member.review', method: 'post', path: `/admin/users/${ANY_UUID}/approve` },
    { capability: 'member.review', method: 'post', path: `/admin/users/${ANY_UUID}/reject` },
    { capability: 'member.review', method: 'delete', path: `/admin/users/${ANY_UUID}` },
    { capability: 'device.manage', method: 'post', path: `/admin/devices/${ANY_UUID}/disable` },
    { capability: 'request.review', method: 'post', path: `/admin/access-requests/${ANY_UUID}/approve` },
    { capability: 'panel.manage', method: 'post', path: '/admin/panels' },
    { capability: 'role.manage', method: 'post', path: '/admin/roles' },
    { capability: 'portal_user.manage', method: 'post', path: '/admin/portal-users' },
    { capability: 'org_admin.manage', method: 'post', path: `/admin/orgs/${orgId}/portal-users` },
  ];
}

for (const role of ['viewer', 'support', 'owner', 'orgAdmin'] as const) {
  test(`${role}: every mutating route agrees with the capability matrix`, async () => {
    const api = await portalApi(role);
    const failures: string[] = [];

    for (const probe of probes()) {
      const allowed = EXPECTED[probe.capability]!.includes(role);
      const res = await api[probe.method](`${API}${probe.path}`, { data: {} });
      const status = res.status();
      const body = await res.text();

      if (allowed) {
        // It must not be turned away for lacking the capability. Any other
        // refusal — a missing reason, a step-up, an id that does not exist —
        // is the handler doing its job.
        if (status === 403 && /capability|not allowed/i.test(body)) {
          failures.push(`${probe.method.toUpperCase()} ${probe.path} — ${role} SHOULD hold ${probe.capability} but was refused (${body.slice(0, 120)})`);
        }
      } else if (status !== 403) {
        failures.push(`${probe.method.toUpperCase()} ${probe.path} — ${role} must NOT hold ${probe.capability}, got ${status} (${body.slice(0, 120)})`);
      }
    }

    expect(failures.join('\n'), `${failures.length} route(s) disagree with the matrix`).toBe('');
  });
}

test('reads stay open to every global role — a viewer sees everything and changes nothing', async () => {
  const api = await portalApi('viewer');

  for (const path of ['/admin/orgs', `/admin/orgs/${orgId}`, '/admin/users', '/admin/devices', '/admin/dashboard']) {
    const res = await api.get(`${API}${path}`);
    expect(res.status(), `${path} should be readable by a viewer`).toBe(200);
  }
});

test.describe('the organisation admin reads one organisation and nothing else', () => {
  let scope = '';
  let acmeId = '';
  let acmeUserId = '';
  let acmeLicenseId = '';

  test.beforeAll(async () => {
    const admin = await portalApi('orgAdmin');
    const me = await admin.get(`${API}/admin/auth/me`);
    expect(me.status(), await me.text()).toBe(200);
    const body = await me.json() as { scope: string; orgId: string; capabilities: string[] };
    expect(body.scope).toBe('org');
    expect(body.capabilities.sort()).toEqual(['member.manage', 'member.review']);
    scope = body.orgId;

    // Somebody else's ids, obtained as the owner, to probe with.
    const owner = await portalApi('owner');
    const orgs = await (await owner.get(`${API}/admin/orgs?q=acme`)).json() as { rows: { id: string; slug: string }[] };
    acmeId = orgs.rows.find((o) => o.slug === 'acme-engineering')!.id;
    expect(acmeId).not.toBe(scope);
    const people = await (await owner.get(`${API}/admin/users?org=${acmeId}`)).json() as { rows: { user: { id: string } }[] };
    acmeUserId = people.rows[0]!.user.id;
    const lic = await (await owner.get(`${API}/admin/orgs/${acmeId}/license`)).json() as { license: { id: string } };
    acmeLicenseId = lic.license.id;
  });

  test('their own organisation answers 200 on every read', async () => {
    const api = await portalApi('orgAdmin');
    for (const path of [
      `/admin/orgs/${scope}`, `/admin/orgs/${scope}/domains`, `/admin/orgs/${scope}/license`,
      `/admin/orgs/${scope}/requests`, '/admin/roles',
    ]) {
      const res = await api.get(`${API}${path}`);
      expect(res.status(), `${path} should be readable by its own admin`).toBe(200);
    }
  });

  test('another organisation is a 404, never a 403 — its ids cannot be confirmed', async () => {
    const api = await portalApi('orgAdmin');
    for (const path of [
      `/admin/orgs/${acmeId}`, `/admin/orgs/${acmeId}/domains`, `/admin/orgs/${acmeId}/license`,
      `/admin/orgs/${acmeId}/requests`, `/admin/users/${acmeUserId}`, `/admin/users/${acmeUserId}/devices`,
      `/admin/licenses/${acmeLicenseId}/events`,
    ]) {
      const res = await api.get(`${API}${path}`);
      expect(res.status(), `${path} must look like it does not exist`).toBe(404);
    }
    // The same for a write: the row is found, then not found.
    const approve = await api.post(`${API}/admin/users/${acmeUserId}/approve`, { data: {} });
    expect(approve.status()).toBe(404);
  });

  test('the portal-staff surfaces are 403', async () => {
    const api = await portalApi('orgAdmin');
    for (const path of [
      '/admin/dashboard', '/admin/licenses', '/admin/access-requests', '/admin/panels', '/admin/portal-users',
      `/admin/orgs/${scope}/portal-users`,
    ]) {
      const res = await api.get(`${API}${path}`);
      expect(res.status(), `${path} is for portal administrators`).toBe(403);
    }
  });

  test('every list is forced to the scope, and asking for another org is refused', async () => {
    const api = await portalApi('orgAdmin');

    const orgs = await (await api.get(`${API}/admin/orgs`)).json() as { rows: { id: string }[]; total: number };
    expect(orgs.total).toBe(1);
    expect(orgs.rows.map((r) => r.id)).toEqual([scope]);

    const users = await (await api.get(`${API}/admin/users`)).json() as { rows: { user: { orgId: string } }[] };
    expect(users.rows.length).toBeGreaterThan(0);
    for (const r of users.rows) expect(r.user.orgId).toBe(scope);

    const devices = await (await api.get(`${API}/admin/devices`)).json() as { rows: { device: { orgId: string } }[] };
    for (const r of devices.rows) expect(r.device.orgId).toBe(scope);

    const audit = await (await api.get(`${API}/admin/audit-log?pageSize=100`)).json() as {
      rows: { entry: { orgId: string | null; action: string } }[];
    };
    for (const r of audit.rows) {
      expect(r.entry.orgId).toBe(scope);
      // Portal logins and TOTP events carry no org_id, so they never match.
      expect(r.entry.action).not.toMatch(/^portal\./);
    }
    const actions = await (await api.get(`${API}/admin/audit-log/actions`)).json() as { rows: string[] };
    for (const a of actions.rows) expect(a).not.toMatch(/^portal\./);

    for (const path of [`/admin/users?org=${acmeId}`, `/admin/devices?org=${acmeId}`, `/admin/audit-log?org=${acmeId}`]) {
      const res = await api.get(`${API}${path}`);
      expect(res.status(), `${path} names an organisation outside the scope`).toBe(403);
    }
  });
});
