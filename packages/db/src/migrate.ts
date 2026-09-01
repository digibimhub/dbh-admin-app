import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(here, '../../../.env') });
config({ path: resolve(here, '../../../.env.local') });

import { is } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { db, pool, schema } from './client';

const PRELUDE = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`;

/**
 * Every table that carries an updated_at column gets the trigger. Derived
 * from the schema instead of a hand-written list so that adding a table with
 * updated_at can never silently leave its value frozen at insert time.
 */
function tablesWithUpdatedAt(): string[] {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    if (cfg.columns.some((c) => c.name === 'updated_at')) names.add(cfg.name);
  }
  return [...names].sort();
}

const triggerSql = (tables: string[]) => tables.map((t) => `
DROP TRIGGER IF EXISTS trg_${t}_updated ON ${t};
CREATE TRIGGER trg_${t}_updated BEFORE UPDATE ON ${t}
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();`).join('\n');

/**
 * The three summary views are gone.
 *
 * They were created on every migrate and selected from by nothing — and being
 * raw SQL, no typecheck or test could tell when they drifted from the schema
 * they summarised. The one genuinely useful shape (`v_org_summary`, the org
 * list's counts) is now an explicit Drizzle query in
 * `routes/admin/organizations.ts`, where the compiler checks it.
 *
 * Dropped rather than merely un-created: a database migrated before this
 * change still has all three, and they reference columns that no longer exist.
 */
const DROP_LEGACY_VIEWS = `
DROP VIEW IF EXISTS v_dormant_orgs;
DROP VIEW IF EXISTS v_expiring_licenses;
DROP VIEW IF EXISTS v_org_summary;
`;

async function main() {
  await pool.query(PRELUDE);
  await pool.query(DROP_LEGACY_VIEWS);
  await migrate(db, { migrationsFolder: './drizzle' });

  const tables = tablesWithUpdatedAt();
  await pool.query(triggerSql(tables));

  console.log(`migrations applied`);
  console.log(`  updated_at triggers: ${tables.length} (${tables.join(', ')})`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
