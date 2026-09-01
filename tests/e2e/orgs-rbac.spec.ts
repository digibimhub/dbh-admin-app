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
    { capability: 'user.manage', method: 'post', path: `/admin/users/${ANY_UUID}/disable` },
    { capability: 'user.import', method: 'post', path: '/admin/users/import/preview' },
    { capability: 'device.manage', method: 'post', path: `/admin/devices/${ANY_UUID}/disable` },
    { capability: 'request.review', method: 'post', path: `/admin/access-requests/${ANY_UUID}/approve` },
    { capability: 'panel.manage', method: 'post', path: '/admin/panels' },
    { capability: 'role.manage', method: 'post', path: '/admin/roles' },
    { capability: 'portal_user.manage', method: 'post', path: '/admin/portal-users' },
  ];
}

for (const role of ['viewer', 'support', 'owner'] as const) {
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

test('reads stay open to every role — a viewer sees everything and changes nothing', async () => {
  const api = await portalApi('viewer');

  for (const path of ['/admin/orgs', `/admin/orgs/${orgId}`, '/admin/users', '/admin/devices', '/admin/dashboard']) {
    const res = await api.get(`${API}${path}`);
    expect(res.status(), `${path} should be readable by a viewer`).toBe(200);
  }
});
