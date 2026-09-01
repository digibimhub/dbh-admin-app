/**
 * Portable Postgres 16 for local development.
 *
 * Docker Desktop needs WSL2, elevation and a reboot, none of which are
 * available on every dev machine here. This downloads the official
 * EnterpriseDB Postgres binaries into .localdb/ and runs the server as a
 * plain user process on the same port, with the same credentials, as the
 * docker-compose service. Nothing outside .localdb/ is touched and no
 * Windows service is registered — delete the folder and it is gone.
 *
 * docker-compose.yml remains the documented path for teammates and CI.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALDB = path.join(ROOT, '.localdb');
const PGSQL = path.join(LOCALDB, 'pgsql');
const BIN = path.join(PGSQL, 'bin');
const DATA = path.join(LOCALDB, 'data');
const LOG = path.join(LOCALDB, 'postgres.log');
const ZIP = path.join(LOCALDB, 'postgres.zip');

const PG_VERSION = '16.8-1';
const URL = `https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-windows-x64-binaries.zip`;

// Must match docker-compose.yml and DATABASE_URL in .env.
const USER = 'licensing';
const PASSWORD = 'localdev';
const DB = 'licensing';
const PORT = '5432';

const exe = (n) => path.join(BIN, process.platform === 'win32' ? `${n}.exe` : n);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} exited ${r.status}`);
  return r;
}

function quiet(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

/* ---------- 1. binaries ---------- */
if (!fs.existsSync(exe('pg_ctl'))) {
  fs.mkdirSync(LOCALDB, { recursive: true });
  console.log(`downloading postgres ${PG_VERSION} (~130 MB, once)…`);
  // curl ships with Windows 10+; -L follows the EDB redirect.
  run('curl', ['-fL', '--progress-bar', '-o', ZIP, URL]);
  console.log('extracting…');
  // bsdtar ships with Windows 10+ and reads zip. The archive root is pgsql/.
  run('tar', ['-xf', ZIP, '-C', LOCALDB]);
  fs.rmSync(ZIP, { force: true });
  if (!fs.existsSync(exe('pg_ctl'))) throw new Error('extract did not produce .localdb/pgsql/bin');
  console.log('binaries ready');
} else {
  console.log('binaries already present');
}

/* ---------- 2. cluster ---------- */
if (!fs.existsSync(path.join(DATA, 'PG_VERSION'))) {
  console.log('initialising cluster…');
  const pwfile = path.join(LOCALDB, '.initpw');
  fs.writeFileSync(pwfile, PASSWORD);
  try {
    run(exe('initdb'), [
      '-D', DATA, '-U', USER, `--pwfile=${pwfile}`,
      '-E', 'UTF8', '--locale=C', '-A', 'scram-sha-256',
    ]);
  } finally {
    fs.rmSync(pwfile, { force: true });
  }
  // Bind loopback only. This cluster holds dev seed data and must never be
  // reachable from the network.
  fs.appendFileSync(path.join(DATA, 'postgresql.conf'),
    `\nlisten_addresses = '127.0.0.1'\nport = ${PORT}\n`);
  console.log('cluster initialised');
} else {
  console.log('cluster already initialised');
}

/* ---------- 3. server ---------- */
const status = quiet(exe('pg_ctl'), ['-D', DATA, 'status']);
if (status.status === 0) {
  console.log('server already running');
} else {

  console.log('starting server…');
  // stdio must NOT be inherited: the postgres server keeps whatever handles
  // pg_ctl hands it, so an inherited stdout pipe never closes and every
  // caller of this script appears to hang forever after a successful start.
  // pg_ctl -l already sends the server's own output to the log file.
  run(exe('pg_ctl'), ['-D', DATA, '-l', LOG, '-o', `-p ${PORT}`, '-w', 'start'],
    { stdio: 'ignore' });
}

/* ---------- 4. database ---------- */
const env = { ...process.env, PGPASSWORD: PASSWORD };
const exists = quiet(exe('psql'), [
  '-h', '127.0.0.1', '-p', PORT, '-U', USER, '-d', 'postgres', '-tAc',
  `SELECT 1 FROM pg_database WHERE datname='${DB}'`,
], { env });

if (exists.stdout?.trim() === '1') {
  console.log(`database "${DB}" already exists`);
} else {
  run(exe('createdb'), ['-h', '127.0.0.1', '-p', PORT, '-U', USER, DB], { env });
  console.log(`database "${DB}" created`);
}

console.log(`\npostgres ${PG_VERSION} up on 127.0.0.1:${PORT}`);
console.log(`DATABASE_URL=postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB}`);
console.log('next: pnpm db:migrate && pnpm db:seed');
