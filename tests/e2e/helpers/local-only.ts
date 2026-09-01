/**
 * Re-export of the locality rule for the E2E harness.
 *
 * `packages/db/src/local-only.ts` is the canonical version, but importing it
 * here would pull TypeScript out of a symlinked workspace package, which
 * Playwright's transform does not cover. Same six hostnames, same fail-closed
 * behaviour — if you change one, change both.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isLocalDatabase(connectionString: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}
