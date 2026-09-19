import type { PortalRole } from './types';

/**
 * UI-side capability map.
 *
 * This is a MIRROR of `CAPABILITY_MATRIX` in `packages/shared/src/index.ts`,
 * which is what the API enforces with `requireCapability` on every mutating
 * admin route. It is duplicated rather than imported because this app has no
 * dependency on `@app/shared` — pulling it in would put zod in the browser
 * bundle for the sake of one table.
 *
 * Its job is to HIDE what a role cannot do, so nobody is shown a button that
 * will 403. It is not the boundary and never was. Since `/admin/auth/me`
 * started returning `capabilities[]`, `useCan` prefers the server's list and
 * only falls back to this table when the session predates it — so the mirror
 * can lag by a release without hiding the wrong button.
 * `tests/e2e/orgs-rbac.spec.ts` walks every role against the real routes, so
 * the two copies cannot drift in silence.
 *
 *   owner      Everything, including portal users and TOTP resets
 *   admin      Everything except portal user management
 *   support    View all, approve requests, disable devices. No licence or org changes
 *   viewer     Read only
 *   org_admin  One organisation only: review its requests, manage its members
 */
export type Capability =
  | 'org.create'
  | 'org.edit'
  | 'org.suspend'
  | 'license.manage'
  | 'domain.manage'
  | 'user.manage'
  | 'user.import'
  | 'device.manage'
  | 'request.review'
  | 'panel.manage'
  | 'role.manage'
  | 'portal_user.manage'
  | 'member.review'
  | 'member.manage'
  | 'org_admin.manage';

const ALL: Capability[] = [
  'org.create', 'org.edit', 'org.suspend', 'license.manage', 'domain.manage',
  'user.manage', 'user.import', 'device.manage', 'request.review',
  'panel.manage', 'role.manage', 'portal_user.manage',
  'member.review', 'member.manage', 'org_admin.manage',
];

const MATRIX: Record<PortalRole, Capability[]> = {
  owner: ALL,
  admin: ALL.filter((c) => c !== 'portal_user.manage'),
  support: ['request.review', 'device.manage'],
  viewer: [],
  org_admin: ['member.review', 'member.manage'],
};

export function can(role: PortalRole | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[role].includes(capability);
}

export const ROLE_LABEL: Record<PortalRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  support: 'Support',
  viewer: 'Viewer',
  org_admin: 'Organisation admin',
};

/** One line per role, in the words the table above uses. Shown on the account page. */
export const ROLE_DESCRIPTION: Record<PortalRole, string> = {
  owner: 'Everything, including portal users and authenticator resets.',
  admin: 'Everything except managing portal users.',
  support: 'Sees everything. Reviews access requests and disables devices. No licence or organisation changes.',
  viewer: 'Read only.',
  org_admin: 'Approves and manages the members of one organisation. No licence, domain or portal changes.',
};

/** Actions the API guards with `requireStepUp` — the UI must collect a TOTP first. */
export const STEP_UP_ACTIONS = new Set([
  'org.suspend',
  'license.suspend',
  'portal_user.create',
  'portal_user.reset_totp',
  'org_admin.create',
  'member.delete',
]);
