import { z } from 'zod';

/**
 * `multiple_orgs` is gone: `org_domains.value` is globally unique, so a domain
 * resolves to exactly one organisation or to none, and there is no ambiguity
 * left to report.
 *
 * `seats_exhausted` replaces it. It is a *soft* denial — the person exists,
 * their organisation is right, and their session stays valid; they are waiting
 * on an operator to free a seat or raise the count.
 */
export const denyCode = z.enum([
  'email_not_verified',
  'domain_not_registered',
  'pending_approval',
  'seats_exhausted',
  'user_disabled',
  'device_disabled',
  'org_suspended',
  'license_missing',
  'license_suspended',
  'license_expired',
  'license_not_started',
  'offline_grace_exceeded',
  'invalid_token',
]);
export type DenyCode = z.infer<typeof denyCode>;

/**
 * The panel slugs compiled into shipped DLLs.
 *
 * `panel_definitions` in the database is the CATALOG an operator edits, and it
 * is what ROLES grant from (`roles.scopes`, optionally overridden per licence
 * by `license_roles.scopes`). This list is the compile-time mirror of the
 * slugs currently baked into add-ins in the field, and it is deliberately not
 * used to validate a grant: a slug added to the catalog must be grantable
 * before every workstation has the DLL that renders it. Use `panelSlug` to
 * validate, `panelId` only where the code genuinely needs one of the known six
 * (feature switches, seeds, fixtures).
 *
 * These mirror the `Panels` array in the add-in's Ribbon/RibbonBuilder.cs.
 *
 * Keep in sync with DEFAULT_PANELS in packages/db/src/seed/bootstrap.ts. Slugs
 * are append-only — renaming one silently removes a panel from every installed
 * add-in.
 */
export const PANEL_IDS = [
  'cleanup',
  'parameters',
  'excel',
  'coordination',
  'troubleshoot',
  'general',
] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/**
 * Panels that must be on every licence. `general` carries About, Updates and
 * Sign in, so a licence without it would leave the user unable to sign in and
 * therefore unable to recover the licence. Mirrored by `never_gated` in
 * panel_definitions, which is what the API actually enforces.
 */
export const NEVER_GATED_PANEL_IDS: readonly PanelId[] = ['general'];

/** Strict form of `panelSlug`, limited to the slugs shipped in current DLLs. */
export const panelId = z.enum(PANEL_IDS);

export const panelSlug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'slug must be lowercase snake_case');

/**
 * A `roles.key`. Same lexical rule as a panel slug and for the same reason:
 * it is an identifier that other systems store, so it must never contain
 * anything that needs escaping or case-folding. Unlike `roles.name`, it is
 * fixed at creation — see `patchRoleSchema`.
 */
export const roleKey = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'key must be lowercase snake_case');

export const deviceInfoSchema = z.object({
  deviceHash: z.string().min(16).max(128),
  machineName: z.string().max(120).optional(),
  osVersion: z.string().max(80).optional(),
  revitVersion: z.string().max(24).optional(),
  addinVersion: z.string().max(24).optional(),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export const authStartSchema = z.object({
  device: deviceInfoSchema,
  redirectPort: z.number().int().min(1024).max(65535),
});

export const tokenRefreshSchema = z.object({
  refreshToken: z.string().min(20),
  device: deviceInfoSchema,
  daysSinceLastSuccess: z.number().int().min(0).max(3650).default(0),
});

export const addinTokenClaims = z.object({
  iss: z.string(),
  sub: z.string(),
  org: z.string(),
  org_name: z.string(),
  email: z.string(),
  /**
   * The role KEY, and informational only. The add-in must never branch on it —
   * that is what `scopes` is for. Carrying it lets a support engineer read a
   * token and know why the scopes are what they are.
   */
  role: roleKey,
  /**
   * The resolved capability list: the role's scopes (or the licence's override
   * of them) unioned with every never-gated slug. The add-in gates features on
   * these and nothing else, which is what makes a role rename — of its display
   * name or its key — invisible to every installed DLL.
   */
  scopes: z.array(panelSlug),
  license_end: z.string(),
  grace_days: z.number(),
  next_check: z.string(),
  exp: z.number(),
});
export type AddinTokenClaims = z.infer<typeof addinTokenClaims>;

export const portalRole = z.enum(['owner', 'admin', 'support', 'viewer']);
export type PortalRole = z.infer<typeof portalRole>;

export const orgStatus = z.enum(['active', 'suspended']);
export const licenseMode = z.enum(['internal', 'trial', 'standard']);
export type LicenseMode = z.infer<typeof licenseMode>;
export const licenseStatus = z.enum(['active', 'suspended', 'expired']);
export const memberStatus = z.enum(['active', 'pending', 'disabled']);
export const memberSource = z.enum(['import', 'auto_domain', 'manual', 'approved_request']);
export const deviceStatus = z.enum(['active', 'disabled', 'stale']);
export const requestStatus = z.enum(['pending', 'approved', 'rejected', 'expired']);

export const portalLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(),
  turnstile: z.string().optional(),
});

export const totpConfirmSchema = z.object({
  totp: z.string().regex(/^\d{6}$/),
});

export const createOrgSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  primaryContactEmail: z.string().email().optional(),
});

/** Slug is absent on purpose: it is in URLs and in the audit log. */
export const patchOrgSchema = createOrgSchema.omit({ slug: true }).partial();

/**
 * A domain is a hostname and nothing else. `kind`, `label`, `allowSubdomains`
 * and the verification dance are all gone — the value is the whole record, and
 * `org_domains.value` is globally unique, so registering one is either
 * accepted or refused with the name of the organisation that already holds it.
 */
export const createDomainSchema = z.object({
  value: z
    .string()
    .min(4)
    .max(200)
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
      'must be a bare domain, e.g. acme-eng.com',
    ),
});

export const seatSchema = z.object({
  roleKey,
  seats: z.number().int().min(0).max(100_000),
});

export const createLicenseSchema = z.object({
  mode: licenseMode.default('trial'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  graceDays: z.number().int().min(0).max(90).default(7),
  seats: z.array(seatSchema).default([]),
});

export const patchLicenseSchema = createLicenseSchema.partial();

export const extendLicenseSchema = z
  .object({
    months: z.number().int().min(1).max(36).optional(),
    newEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    reason: z.string().min(3).max(500),
  })
  .refine((v) => v.months || v.newEndDate, { message: 'months or newEndDate required' });

/* -------------------------------------------------------------- roles ---- */

export const createRoleSchema = z.object({
  key: roleKey,
  name: z.string().min(2).max(60),
  description: z.string().max(400).optional(),
  scopes: z.array(panelSlug).default([]),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

/**
 * `key` is deliberately absent.
 *
 * The key is what `org_users.role_key`, `license_roles.role_key` and the add-in
 * token all carry; `name` is what every screen renders. Keeping the key out of
 * the patch surface is what makes "rename a role" a one-column UPDATE that
 * cannot break a reference, which is the entire reason roles are a table
 * rather than an enum. Retire a role with `isActive: false`; never delete one,
 * or every historical member row is orphaned.
 */
export const patchRoleSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  description: z.string().max(400).nullable().optional(),
  scopes: z.array(panelSlug).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const createUserSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email(),
  autodeskId: z.string().min(3).max(80).optional(),
  displayName: z.string().max(120).optional(),
  roleKey: roleKey.optional(),
});

export const patchUserSchema = z.object({
  displayName: z.string().max(120).optional(),
  roleKey: roleKey.optional(),
  status: memberStatus.optional(),
});

export const approveRequestSchema = z.object({
  orgId: z.string().uuid(),
  roleKey: roleKey.optional(),
});

export const rejectRequestSchema = z.object({
  note: z.string().min(2).max(500),
});

export const createPanelSchema = z.object({
  slug: panelSlug,
  label: z.string().min(2).max(80),
  description: z.string().max(400).optional(),
  sortOrder: z.number().int().min(0).max(999).default(0),
  /** Structural panels that every licence must grant — see panel_definitions. */
  neverGated: z.boolean().default(false),
});

/**
 * `neverGated` is deliberately absent: it is a property of the add-in's ribbon,
 * not an operator preference, and flipping it off on an existing panel would
 * let a licence be written that locks users out of signing in. Set it when the
 * panel is created, or change it with a migration.
 */
export const patchPanelSchema = z.object({
  label: z.string().min(2).max(80).optional(),
  description: z.string().max(400).nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

export const createPortalUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().max(120).optional(),
  role: portalRole,
  password: z.string().min(12).max(200),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().max(120).optional(),
});

/* ------------------------------------------------------------------ *
 * Add-in contract
 *
 * These shapes are consumed by LicenseClient.dll, which is compiled into
 * shipped installers. Fields here are append-only: removing or renaming one
 * breaks every add-in already in the field.
 * ------------------------------------------------------------------ */

/** Body of POST /v1/auth/exchange — swaps the browser handoff for tokens. */
export const authExchangeSchema = z.object({
  handoff: z.string().min(16).max(200),
});

/**
 * Every denial, including the ones that are really "you are not allowed".
 * Sent as HTTP 200 so the add-in handles all denials through one code path
 * instead of branching on transport status.
 */
export const denyResponseSchema = z.object({
  status: z.literal('denied'),
  code: denyCode,
  message: z.string(),
  action: z.string(),
  retry_after: z.number().int().min(0).optional(),
});
export type DenyResponse = z.infer<typeof denyResponseSchema>;

/** Success body of /v1/auth/exchange and /v1/token/refresh. */
export const addinTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive(),
  next_check: z.string(),
  scopes: z.array(panelSlug).optional(),
  role: roleKey.optional(),
  session_id: z.string().optional(),
});
export type AddinTokenResponse = z.infer<typeof addinTokenResponseSchema>;

/* ------------------------------------------------------------------ *
 * Portal mutations
 *
 * Bodies the admin UI posts. Anything reaching the database needs a schema
 * here rather than an inline `as { ... }` cast at the route, which is a type
 * assertion and validates nothing at runtime.
 * ------------------------------------------------------------------ */

/**
 * Disable / suspend / reset bodies. The reason is required because it lands in
 * `audit_log`, and a disable with no recorded reason is the row support cannot
 * explain six months later.
 */
export const reasonSchema = z.object({
  reason: z.string().min(3).max(500),
});

/** POST /admin/users/:id/role */
export const setMemberRoleSchema = z.object({
  roleKey,
});

export const patchPortalUserSchema = z.object({
  displayName: z.string().max(120).optional(),
  role: portalRole.optional(),
  isActive: z.boolean().optional(),
});

/* ------------------------------------------------------------------ *
 * List filters
 *
 * Query strings arrive as strings or undefined, so these coerce and default.
 * Parsing them keeps an unbounded `status=` or a non-numeric `page=` out of
 * the query builder.
 * ------------------------------------------------------------------ */

export const orgQuerySchema = paginationSchema.extend({
  status: orgStatus.optional(),
});

export const userQuerySchema = paginationSchema.extend({
  org: z.string().uuid().optional(),
  role: roleKey.optional(),
  status: memberStatus.optional(),
  source: memberSource.optional(),
});

export const deviceQuerySchema = paginationSchema.extend({
  org: z.string().uuid().optional(),
  status: deviceStatus.optional(),
  revit: z.string().max(24).optional(),
});

export const requestQuerySchema = z.object({
  status: requestStatus.default('pending'),
});

export const auditQuerySchema = paginationSchema.extend({
  org: z.string().uuid().optional(),
  actor: z.string().uuid().optional(),
  action: z.string().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const usageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
