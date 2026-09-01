/**
 * Refuse to destroy a database that is not on this machine.
 *
 * `NODE_ENV` is a poor guard on its own: it defaults to `development`, so a
 * shell that simply never set it will happily truncate whatever `DATABASE_URL`
 * happens to point at — a staging box, a colleague's tunnel, production behind
 * a port-forward. The host is the fact that actually distinguishes them, and it
 * travels with the connection string rather than with the shell.
 *
 * There is deliberately no override flag. The repo already argues the case for
 * the APS host check in `apps/api/src/env.ts`: a bypass that exists but is
 * "switched off" is one environment variable away from being switched on. If
 * you genuinely need to reset a remote database, do it by hand and mean it.
 *
 * The JS twin of this file is `scripts/local-only.mjs`, for the `.mjs` wrappers
 * that cannot import TypeScript. Keep them in step.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isLocalDatabase(connectionString: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(connectionString).hostname);
  } catch {
    // An unparseable URL is not a local one. Fail closed.
    return false;
  }
}

export function assertLocalDatabase(connectionString: string, command: string): void {
  if (isLocalDatabase(connectionString)) return;
  let where = 'an unparseable DATABASE_URL';
  try {
    const u = new URL(connectionString);
    where = `${u.hostname}:${u.port || 5432}`;
  } catch { /* keep the fallback */ }
  throw new Error(
    `${command} refuses to run against ${where}. It destroys data, and only a `
    + 'database on this machine (localhost or 127.0.0.1) is safe to assume is yours.',
  );
}
