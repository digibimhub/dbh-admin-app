import { sql } from 'drizzle-orm';
import { db, type Db } from '../client';
import * as s from '../schema';

/**
 * The rows a database needs before anything else can happen, and the TRUNCATE
 * that clears the way for them.
 *
 * Two callers share this file: `seed/index.ts`, which lays down the full demo
 * world on top, and `seed/reset.ts` (`pnpm db:reset`), which stops here. They
 * used to be one script and a hand-copied SQL statement; keeping the statement
 * in one place is the only thing that stops a table added to the schema from
 * being truncated by one path and left behind by the other.
 */

/**
 * Free mailbox providers. `org_domains` matches on email domain, so without
 * this list `gmail.com` is a perfectly acceptable claim to an organisation and
 * the first person to sign in with one auto-provisions everybody else who has
 * one. Policy data, not demo data — a reset database needs it.
 */
export const PUBLIC_MAILBOXES = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com',
  'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com',
  'zoho.com', 'rediffmail.com', 'qq.com', '163.com',
];

/**
 * The real ribbon, mirroring `Panels` in the add-in's RibbonBuilder.cs.
 *
 * These slugs are compiled into shipped DLLs, so the list is append-only:
 * renaming one does not fail anywhere, it just silently hides a panel on every
 * workstation already in the field. Add rows, never rewrite them.
 *
 * `general` is never gated. It carries About, Updates and the Sign in button —
 * if a licensing failure could hide it, the failure would also remove the only
 * means of fixing it.
 */
export const DEFAULT_PANELS = [
  { slug: 'cleanup', label: 'Cleanup', description: 'Delete Duplicates — bulk deletion, project-wide scope', sortOrder: 10 },
  { slug: 'parameters', label: 'Parameters', description: 'Mass Parameters — bulk parameter writes', sortOrder: 20 },
  { slug: 'excel', label: 'Excel', description: 'Export to Excel, Import from Excel', sortOrder: 30 },
  { slug: 'coordination', label: 'Coordination', description: 'Link Manager — batch model linking', sortOrder: 40 },
  { slug: 'troubleshoot', label: 'Troubleshoot', description: 'Diagnose Duplicates — read-only diagnostics', sortOrder: 50 },
  { slug: 'general', label: 'General', description: 'About, Updates, Sign in', sortOrder: 60, neverGated: true },
];

/**
 * The three member roles, seeded because the system cannot provision anybody
 * without at least a default one.
 *
 * `key` is the contract — it is what `org_users.role_key`, `license_roles` and
 * the token's `role` claim carry, and it never changes. `name` is the display
 * string and is free to be renamed in Settings without touching a single other
 * row. That split is the whole reason roles are a table.
 *
 * `scopes` grade deliberately, so the seed exercises a real difference rather
 * than three identical rows. `general` is never gated and is unioned in during
 * resolution regardless; it is listed here only so the rows read honestly.
 */
export const DEFAULT_ROLES = [
  {
    key: 'admin',
    name: 'Admin',
    description: 'Full add-in capability, including coordination and diagnostics.',
    scopes: ['cleanup', 'parameters', 'excel', 'coordination', 'troubleshoot', 'general'],
    sortOrder: 10,
  },
  {
    key: 'coordinator',
    name: 'Coordinator',
    description: 'Modelling and coordination, without diagnostics.',
    scopes: ['cleanup', 'parameters', 'excel', 'coordination', 'general'],
    sortOrder: 20,
  },
  {
    key: 'user',
    name: 'User',
    description: 'Everyday modelling. Granted automatically on first sign-in.',
    scopes: ['cleanup', 'general'],
    sortOrder: 30,
    isDefault: true,
  },
];

/**
 * Empties every table, including `portal_users` — the caller is left with a
 * database nobody can log into until a portal user is created.
 *
 * `signing_keys` is in the list and self-heals: `lib/signing.ts` re-publishes
 * the configured key at API boot.
 *
 * KEEP THIS LIST IN STEP WITH THE SCHEMA. A dropped table left here is loud —
 * Postgres rejects an unknown relation — but a NEW table omitted here is
 * silent: its rows survive every seed, so duplicates accumulate and stale rows
 * point at parents that were truncated underneath them. Seventeen tables.
 */
export async function truncateAll(conn: Db = db): Promise<void> {
  await conn.execute(sql`
    TRUNCATE usage_daily, access_requests, addin_sessions, oauth_states,
             devices, org_users, license_events, license_roles, licenses,
             org_domains, organizations, audit_log, portal_users,
             blocked_domains, panel_definitions, roles, signing_keys
    RESTART IDENTITY CASCADE`);
}

/**
 * The catalog tables. Nothing here describes a customer, so both the demo seed
 * and a reset-to-empty database want exactly these rows.
 *
 * Order matters: roles reference panel slugs by value, and everything that
 * provisions a user references a role key.
 */
export async function insertBootstrapRows(conn: Db = db): Promise<void> {
  await conn.insert(s.blockedDomains).values(
    PUBLIC_MAILBOXES.map((value) => ({ value, reason: 'public_mailbox' })),
  );

  await conn.insert(s.panelDefinitions).values(DEFAULT_PANELS);
  await conn.insert(s.roles).values(DEFAULT_ROLES);
}

/** TRUNCATE, then the catalog rows. The whole of `pnpm db:reset`. */
export async function resetToBootstrap(conn: Db = db): Promise<void> {
  await truncateAll(conn);
  await insertBootstrapRows(conn);
}
