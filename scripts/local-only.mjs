/**
 * The JS twin of `packages/db/src/local-only.ts`, for the `.mjs` wrappers that
 * cannot import TypeScript. Same rule, same reasoning, no override: refuse to
 * destroy a database that is not on this machine, because `NODE_ENV` defaults
 * to `development` and so guards nothing on a shell that never set it.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isLocalDatabase(connectionString) {
  try {
    return LOCAL_HOSTS.has(new URL(connectionString).hostname);
  } catch {
    return false; // fail closed
  }
}

/** Prints and exits on a remote target; returns on a local one. */
export function assertLocalDatabase(connectionString, command) {
  if (isLocalDatabase(connectionString)) return;
  let where = 'an unparseable DATABASE_URL';
  try {
    const u = new URL(connectionString);
    where = `${u.hostname}:${u.port || 5432}`;
  } catch { /* keep the fallback */ }
  console.error('');
  console.error(`  ${command} refuses to run against ${where}.`);
  console.error('  It destroys data, and only a database on this machine');
  console.error('  (localhost or 127.0.0.1) is safe to assume is yours.');
  console.error('');
  process.exit(1);
}
