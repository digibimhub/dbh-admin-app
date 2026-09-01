/**
 * Empties the database and reinstates only the bootstrap rows —
 * `blocked_domains` and `panel_definitions`. No orgs, no users, no devices,
 * no usage: the state you want when you are about to point the real Autodesk
 * flow at it and watch rows appear.
 *
 *   pnpm db:reset          ask first, then reset
 *   pnpm db:reset -- --yes skip the prompt (CI, scripted runs)
 *
 * The demo dataset is not gone — `pnpm db:seed` puts all of it back. The two
 * share `packages/db/src/seed/bootstrap.ts`, so what counts as "clean" is
 * defined once.
 *
 * This file is the prompt and the guard rails; the SQL lives in
 * `packages/db/src/seed/reset.ts`, which is run through tsx below.
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const assumeYes = args.includes('--yes') || args.includes('-y');

/** Just enough .env parsing to name the target in the prompt. Never trusted for connecting. */
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

async function confirm() {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.error('db:reset is destructive and stdin is not a terminal.');
    console.error('Re-run as: pnpm db:reset -- --yes');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Continue? [y/N] ');
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  // The whole point of this script is that it destroys data, so it must never
  // be one stray shell in the wrong window away from doing that to production.
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    console.error('db:reset refuses to run with NODE_ENV=production.');
    process.exit(1);
  }

  console.log('');
  console.log(`  This TRUNCATES every table in ${databaseLabel()}.`);
  console.log('  Kept: the blocked_domains and panel_definitions catalogs.');
  console.log('  Lost: portal users, orgs, licences, devices, usage, audit log.');
  console.log('  `pnpm db:seed` restores the full demo dataset afterwards.');
  console.log('');

  if (!await confirm()) {
    console.log('cancelled — nothing was changed');
    process.exit(1);
  }

  // tsx is a root devDependency; resolving it beats assuming a PATH shim.
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const r = spawnSync(process.execPath, [tsx, path.join(ROOT, 'packages/db/src/seed/reset.ts')], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  process.exit(r.status ?? 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
