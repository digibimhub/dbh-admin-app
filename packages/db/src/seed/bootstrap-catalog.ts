import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(here, '../../../../.env') });
config({ path: resolve(here, '../../../../.env.local') });

import { sql } from 'drizzle-orm';
import { db, pool } from '../client';
import * as s from '../schema';
import { PUBLIC_MAILBOXES, DEFAULT_PANELS, DEFAULT_ROLES } from './bootstrap';

/**
 * Insert-only catalog bootstrap for a database that must not be truncated.
 *
 * `pnpm db:reset` refuses any host that is not this machine, deliberately —
 * a remote database is exactly what that guard exists to protect. But a fresh
 * production database still needs the catalog rows before anything can happen,
 * so this is the non-destructive path: the same `PUBLIC_MAILBOXES`,
 * `DEFAULT_PANELS` and `DEFAULT_ROLES` that `bootstrap.ts` owns, inserted
 * without the TRUNCATE and without a locality guard.
 *
 * Idempotent by primary key: `.onConflictDoNothing()` leaves existing rows
 * untouched, so running it twice — or against a database that already has
 * customers — changes nothing that was already there. It never deletes and
 * never updates.
 */
async function main(): Promise<void> {
  await db.insert(s.blockedDomains)
    .values(PUBLIC_MAILBOXES.map((value) => ({ value, reason: 'public_mailbox' })))
    .onConflictDoNothing();
  await db.insert(s.panelDefinitions).values(DEFAULT_PANELS).onConflictDoNothing();
  await db.insert(s.roles).values(DEFAULT_ROLES).onConflictDoNothing();

  const counts = await db.execute(sql`
    SELECT (SELECT count(*)::int FROM blocked_domains)   AS domains,
           (SELECT count(*)::int FROM panel_definitions) AS panels,
           (SELECT count(*)::int FROM roles)             AS roles`);
  const row = counts.rows[0] as
    { domains: number; panels: number; roles: number } | undefined;

  console.log('catalog bootstrap complete (existing rows left untouched)');
  console.log(`  blocked_domains:   ${row?.domains ?? 0} (expected >= ${PUBLIC_MAILBOXES.length})`);
  console.log(`  panel_definitions: ${row?.panels ?? 0} (expected >= ${DEFAULT_PANELS.length})`);
  console.log(`  roles:             ${row?.roles ?? 0} (expected >= ${DEFAULT_ROLES.length})`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
