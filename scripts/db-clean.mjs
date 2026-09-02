/**
 * Empties the business data but keeps the login and the catalogues.
 *
 *   pnpm db:clean            ask first, then clean
 *   pnpm db:clean -- --yes   skip the prompt
 *
 * The state you want before walking the portal by hand: no organisations to
 * distract you, but you can still sign in and still provision somebody.
 *
 * KEPT — one portal user (`admin@yourco.local`, the only `owner`, with the
 * password hash and encrypted TOTP secret that `pnpm totp` and the dev hint
 * expect), the three member roles, the six panel definitions and the blocked
 * public-mailbox list, plus the signing key.
 *
 * Roles and panels are kept together on purpose. `roles.scopes` holds
 * `panel_definitions.slug` values, `general` is never-gated by a column on that
 * table, and editing a role validates its scopes against it — so a database
 * with roles and no panels is one where `general` is suddenly gateable and no
 * role can be saved.
 *
 * LOST — organisations and everything hanging off them, access requests,
 * oauth states and the audit log.
 *
 * This sits between the two that already exist:
 *
 *   db:clean   catalogues + one operator      you can log in, nothing to see
 *   db:reset   catalogues only                nobody can log in at all
 *   db:seed    the full three-org demo world
 *
 * DELETE, not TRUNCATE: AGENTS.md rules out raw DDL, and the foreign keys back
 * to `portal_users` are all ON DELETE NO ACTION, so the order below is the
 * point of the file.
 */
import { createInterface } from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertLocalDatabase } from './local-only.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const assumeYes = args.includes('--yes') || args.includes('-y');
const KEEP_EMAIL = process.env.KEEP_PORTAL_EMAIL ?? 'admin@yourco.local';

function readEnv(name) {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

function label(url) {
  try {
    const u = new URL(url);
    return `${u.pathname.replace(/^\//, '')} on ${u.hostname}:${u.port || 5432}`;
  } catch {
    return '(DATABASE_URL is set but unparseable)';
  }
}

async function confirm() {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.error('db:clean is destructive and stdin is not a terminal.');
    console.error('Re-run as: pnpm db:clean -- --yes');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Continue? [y/N] ');
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    console.error('db:clean refuses to run with NODE_ENV=production.');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL ?? readEnv('DATABASE_URL');
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  // Before the prompt, not after: nobody should be one keystroke from
  // emptying a database that is not on this machine.
  assertLocalDatabase(connectionString, 'db:clean');

  console.log('');
  console.log(`  This empties the business data in ${label(connectionString)}.`);
  console.log(`  Kept: ${KEEP_EMAIL}, the roles, panels and blocked-domain catalogues.`);
  console.log('  Lost: organisations, domains, licences, people, devices,');
  console.log('        sessions, usage, access requests and the audit log.');
  console.log('  `pnpm db:seed` restores the full demo dataset afterwards.');
  console.log('');

  if (!await confirm()) {
    console.log('cancelled — nothing was changed');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');

    const { rows: [keep] } = await client.query(
      'SELECT id FROM portal_users WHERE email = $1',
      [KEEP_EMAIL],
    );
    if (!keep) {
      throw new Error(
        `no portal user ${KEEP_EMAIL} — refusing to leave a database nobody can sign in to. `
        + 'Run `pnpm db:seed`, or set KEEP_PORTAL_EMAIL.',
      );
    }

    // Cascades licences (with their seats and events), domains, members,
    // devices, add-in sessions and usage. Audit rows survive with a null org,
    // which is why they are cleared separately below.
    const orgs = await client.query('DELETE FROM organizations');
    // These carry reviewed_by / actor_id references to portal_users, so they
    // have to go before the users do.
    await client.query('DELETE FROM access_requests');
    await client.query('DELETE FROM oauth_states');
    await client.query('DELETE FROM audit_log');
    const users = await client.query('DELETE FROM portal_users WHERE id <> $1', [keep.id]);

    await client.query('COMMIT');
    console.log(`  removed ${orgs.rowCount} organisation(s) and ${users.rowCount} other portal user(s)`);
    console.log(`  ${KEEP_EMAIL} can still sign in — print a code with \`pnpm totp\``);
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  failed, nothing was changed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
