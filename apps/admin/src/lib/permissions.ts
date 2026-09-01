import type { PortalRole } from './types';

/**
 * UI-side capability map.
 *
 * The API enforces authorization regardless — this exists so the interface can
 * HIDE what a role cannot do instead of showing buttons that will 403. Never
 * treat it as a security boundary.
 *
 *   owner    Everything, including portal users and TOTP resets
 *   admin    Everything except portal user management
 *   support  View all, approve requests, disable devices. No licence or org changes
 *   viewer   Read only
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
  | 'portal_user.manage';

const ALL: Capability[] = [
  'org.create', 'org.edit', 'org.suspend', 'license.manage', 'domain.manage',
  'user.manage', 'user.import', 'device.manage', 'request.review',
  'panel.manage', 'role.manage', 'portal_user.manage',
];

const MATRIX: Record<PortalRole, Capability[]> = {
  owner: ALL,
  admin: ALL.filter((c) => c !== 'portal_user.manage'),
  support: ['request.review', 'device.manage'],
  viewer: [],
};

export function can(role: PortalRole | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[role].includes(capability);
}

/** Capabilities that gate a whole nav entry. */
export const ROLE_LABEL: Record<PortalRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  support: 'Support',
  viewer: 'Viewer',
};

/** Actions the API guards with `requireStepUp` — the UI must collect a TOTP first. */
export const STEP_UP_ACTIONS = new Set([
  'org.suspend',
  'license.suspend',
  'portal_user.create',
  'portal_user.reset_totp',
]);
