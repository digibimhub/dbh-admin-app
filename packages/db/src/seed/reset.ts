import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(here, '../../../../.env') });
config({ path: resolve(here, '../../../../.env.local') });

import { sql } from 'drizzle-orm';
import { db, pool } from '../client';
import { resetToBootstrap, PUBLIC_MAILBOXES, DEFAULT_PANELS } from './bootstrap';

/**
 * Empty but usable: every table cleared, then only the two catalog tables
 * refilled. Nothing here describes a customer, an organisation or a login —
 * the point is a database the real Autodesk flow can populate from nothing.
 *
 * `pnpm db:seed` still restores the full demo world; this is the third state,
 * not a replacement for either of the other two.
 *
 * Reached through `scripts/db-reset.mjs` (`pnpm db:reset`), which owns the
 * confirmation prompt. The production guard is repeated here because this file
 * is also runnable directly and a guard that only lives in the wrapper is a
 * guard one `tsx` invocation away from not existing.
 */
async function main(): Promise<void> {
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    console.error('db:reset refuses to run with NODE_ENV=production.');
    process.exit(1);
  }

  await resetToBootstrap();

  const counts = await db.execute(sql`
    SELECT (SELECT count(*)::int FROM blocked_domains)   AS domains,
           (SELECT count(*)::int FROM panel_definitions) AS panels,
           (SELECT count(*)::int FROM portal_users)      AS users,
           (SELECT count(*)::int FROM organizations)     AS orgs`);
  const row = counts.rows[0] as
    { domains: number; panels: number; users: number; orgs: number } | undefined;

  console.log('database reset to bootstrap state');
  console.log(`  blocked_domains:   ${row?.domains ?? 0} (expected ${PUBLIC_MAILBOXES.length})`);
  console.log(`  panel_definitions: ${row?.panels ?? 0} (expected ${DEFAULT_PANELS.length})`);
  console.log(`  portal_users:      ${row?.users ?? 0}`);
  console.log(`  organizations:     ${row?.orgs ?? 0}`);
  console.log('');
  console.log('  NEXT: pnpm admin:create-user   — nobody can sign in until you do.');

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
