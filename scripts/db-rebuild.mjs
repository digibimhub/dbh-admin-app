/**
 * Drops the database and rebuilds it from the current Drizzle schema, leaving
 * exactly ONE migration file behind.
 *
 *   pnpm db:rebuild              ask, rebuild, then seed the demo world
 *   pnpm db:rebuild --reset      rebuild, then bootstrap rows only
 *   pnpm db:rebuild --bare       rebuild, insert nothing
 *   pnpm db:rebuild --yes        skip the prompt
 *
 * ## Why this exists, and when it must stop existing
 *
 * Until the first commit there is no deployed database and no other developer,
 * so migration history has nothing to protect. Accumulating a file per schema
 * edit would just produce a fossil record of iterations nobody will ever
 * replay, and the eventual first commit would ship twenty migrations
 * describing a schema that only ever existed on one laptop.
 *
 * So: schema changes are made in `packages/db/src/schema/*.ts` and applied by
 * throwing the database away and regenerating a single `0000` baseline.
 *
 * The moment there is a first commit or tag — or any database someone else
 * uses — this script must not be run again. From that point a schema change is
 * a NEW migration via `pnpm db:generate`, because history starts mattering the
 * first time a database exists that cannot simply be recreated. AGENTS.md
 * carries the rule; this comment carries the reason.
 *
 * ## What is safe to regenerate, and why
 *
 * Everything Drizzle cannot emit — the pgcrypto and citext extensions, the
 * `set_updated_at()` function, the per-table updated_at triggers and the three
 * views — lives in `packages/db/src/migrate.ts` and is re-applied on every
 * migrate. None of it is inside the generated SQL, so regenerating the
 * baseline loses nothing.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIZZLE_DIR = path.join(ROOT, 'packages/db/drizzle');

const args = process.argv.slice(2).filter((a) => a !== '--');
const assumeYes = args.includes('--yes') || args.includes('-y');
const bare = args.includes('--bare');
const resetOnly = args.includes('--reset');

/** Just enough .env parsing to name the target in the prompt. */
function databaseLabel() {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/^DATABASE_URL=(.*)$/m);
    if (!m) continue;
    try {
      const u = new URL(m[1].trim().replace(/^["']|["']$/g, ''));
      return `${u.pathname.replace(/^\//, '')} on ${u.hostname}:${u.port || 5432}`;
    } catch {
      return '(DATABASE_URL is set but unparseable)';
    }
  }
  return '(no DATABASE_URL found in .env)';
}

/**
 * Every step runs as `node <script>` rather than through pnpm.
 *
 * pnpm is a .cmd shim on Windows, and since Node 20 spawning a .cmd without a
 * shell fails outright, while spawning one WITH a shell concatenates the
 * arguments unescaped — deprecated, and it would also mangle the semicolons in
 * the DDL below. Resolving the real entry points sidesteps both.
 */
const require_ = createRequire(import.meta.url);
const TSX = require_.resolve('tsx/cli');
// drizzle-kit does not export ./bin.cjs, so require.resolve cannot reach it.
// node-linker=hoisted puts it here; if that ever changes this fails loudly
// rather than silently skipping the regeneration.
const DRIZZLE_KIT = path.join(ROOT, 'node_modules/drizzle-kit/bin.cjs');
const DB_DIR = path.join(ROOT, 'packages/db');

function run(label, cmdArgs, cwd = ROOT) {
  const r = spawnSync(process.execPath, cmdArgs, { stdio: 'inherit', cwd });
  if (r.status !== 0) {
    console.error(`\n  ${label} failed (exit ${r.status ?? 'signal'}). Stopping here.`);
    process.exit(r.status ?? 1);
  }
}

async function confirm() {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.error('db:rebuild drops the schema and stdin is not a terminal.');
    console.error('Re-run as: pnpm db:rebuild --yes');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Continue? [y/N] ');
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    console.error('db:rebuild refuses to run with NODE_ENV=production.');
    process.exit(1);
  }

  const existing = fs.existsSync(DRIZZLE_DIR)
    ? fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'))
    : [];

  console.log('');
  console.log(`  This DROPS AND RECREATES the schema in ${databaseLabel()}.`);
  console.log('  Every table, view, enum, trigger and row goes.');
  console.log(`  It then replaces ${existing.length} migration file(s) with a single regenerated 0000.`);
  console.log('');
  console.log('  Use this only before the first commit. After that, a schema change');
  console.log('  is a new migration via `pnpm db:generate` — see AGENTS.md.');
  console.log('');

  if (!await confirm()) {
    console.log('cancelled — nothing was changed');
    process.exit(1);
  }

  // `drizzle` holds __drizzle_migrations. Dropping only `public` would leave
  // the journal claiming 0000 is already applied, and the regenerated baseline
  // would be skipped against an empty database — which fails later, somewhere
  // unrelated, with a missing table.
  console.log('\n  dropping schemas public and drizzle…');
  run('drop', [
    path.join(ROOT, 'scripts/db-psql.mjs'),
    '-v', 'ON_ERROR_STOP=1',
    '-c', 'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  ]);

  console.log('\n  clearing generated migrations…');
  if (fs.existsSync(DRIZZLE_DIR)) fs.rmSync(DRIZZLE_DIR, { recursive: true, force: true });
  fs.mkdirSync(DRIZZLE_DIR, { recursive: true });

  console.log('\n  regenerating the baseline from packages/db/src/schema…');
  if (!fs.existsSync(DRIZZLE_KIT)) {
    console.error(`\n  drizzle-kit not found at ${DRIZZLE_KIT} — run pnpm install.`);
    process.exit(1);
  }
  run('db:generate', [DRIZZLE_KIT, 'generate'], DB_DIR);

  const made = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'));
  if (made.length !== 1) {
    console.error(`\n  expected exactly one migration, got ${made.length}: ${made.join(', ')}`);
    process.exit(1);
  }

  console.log('\n  applying it, plus extensions, triggers and views…');
  run('db:migrate', [TSX, 'src/migrate.ts'], DB_DIR);

  if (!bare) {
    if (resetOnly) {
      console.log('\n  inserting bootstrap rows…');
      run('db:reset', [TSX, 'src/seed/reset.ts'], DB_DIR);
    } else {
      console.log('\n  seeding the demo world…');
      run('db:seed', [TSX, 'src/seed/index.ts'], DB_DIR);
    }
  }

  console.log('');
  console.log(`  Rebuilt. Baseline is now ${made[0]}.`);
  if (bare) console.log('  Database is empty — `pnpm db:seed` or `pnpm db:reset` next.');
  else if (resetOnly) console.log('  NEXT: pnpm admin:create-user — nobody can sign in until you do.');
  console.log('');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
