/** Stops the portable Postgres started by db-up.mjs. Data is kept. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.localdb', 'data');
const PG_CTL = path.join(ROOT, '.localdb', 'pgsql', 'bin',
  process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');

if (!fs.existsSync(PG_CTL)) {
  console.log('no local cluster — nothing to stop');
  process.exit(0);
}
const r = spawnSync(PG_CTL, ['-D', DATA, '-m', 'fast', 'stop'], { stdio: 'inherit' });
process.exit(r.status === 0 ? 0 : 0);   // already-stopped is not an error
