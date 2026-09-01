import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { createdOrgIds } from './helpers/state';
import { isLocalDatabase } from './helpers/local-only';

/**
 * Remove the organisations this run created.
 *
 * Global SETUP reseeds, which is a truncate — but it runs *before* a suite, not
 * after one. So a finished run used to leave sixteen organisations in the
 * database until somebody happened to run the suite again, and one of them was
 * a deliberate two-hundred-character boundary case that made the Organisations
 * list unreadable. Cleaning up before is a guarantee about the run that follows;
 * this is the guarantee about the machine you are sitting at.
 *
 * It deletes tracked ids and nothing else. Not a `LIKE 'E2E%'` sweep — several
 * of the matrix cases are deliberately named things like `Min Slug` and `Ab`,
 * and a pattern wide enough to catch those is wide enough to catch a real
 * customer. `createOrg` records every id it creates; specs that go through the
 * dialog call `trackOrg`.
 *
 * The delete cascades: `licenses`, `org_domains`, `org_users`, `devices`,
 * `addin_sessions` and `usage_daily` are all `ON DELETE cascade`, while
 * `audit_log.org_id` is `ON DELETE set null` — so the audit trail survives with
 * a null organisation rather than being destroyed with it.
 *
 * `E2E_KEEP_DATA=1` skips it, for when a failure is worth inspecting in situ.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_DATA === '1') {
    process.stdout.write('  E2E_KEEP_DATA=1 — leaving created organisations in place\n');
    return;
  }

  const ids = createdOrgIds();
  if (!ids.length) return;

  const root = process.cwd();
  config({ path: resolve(root, '.env') });
  config({ path: resolve(root, '.env.local') });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    process.stdout.write('  DATABASE_URL is not set — skipping cleanup\n');
    return;
  }

  // The reseed in global SETUP is guarded at truncateAll(), so a remote run
  // never gets this far — but this issues its own DELETEs and should not
  // depend on somebody else having stopped first.
  if (!isLocalDatabase(connectionString)) {
    process.stdout.write('  DATABASE_URL is not local — skipping cleanup\n');
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      'DELETE FROM organizations WHERE id = ANY($1::uuid[])',
      [ids],
    );
    process.stdout.write(`  removed ${rowCount} organisation(s) created by this run\n`);
  } finally {
    await client.end();
  }
}
