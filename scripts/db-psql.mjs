/** psql against the portable cluster: pnpm db:psql -- -c "SELECT 1" */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSQL = path.join(ROOT, '.localdb', 'pgsql', 'bin',
  process.platform === 'win32' ? 'psql.exe' : 'psql');

// pnpm 10 forwards the `--` separator itself, and psql reads it as the end of
// its own options — every flag after it is then silently ignored. Drop it.
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();

const r = spawnSync(PSQL,
  ['-h', '127.0.0.1', '-p', '5432', '-U', 'licensing', '-d', 'licensing', ...args],
  { stdio: 'inherit', env: { ...process.env, PGPASSWORD: 'localdev' } });
process.exit(r.status ?? 1);
