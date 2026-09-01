import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Session state that outlives a worker process.
 *
 * Playwright stops the worker after a failed test and starts a fresh one for
 * the next. Anything memoised in module scope dies with it — which, for a
 * portal login, means the replacement worker logs in again. Six failures is
 * six logins, the budget is five per fifteen minutes per email, and from then
 * on every remaining test fails with a 429 that has nothing to do with what it
 * was asserting.
 *
 * So the login lands on disk instead. One login per role per RUN, however many
 * times the worker is replaced. The directory is emptied by global setup, which
 * is also what reseeds — a cached cookie from a previous run names a portal
 * user id that the reseed has already deleted.
 */
const DIR = join(tmpdir(), 'dbh-e2e-state');

export function resetSharedState(): void {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
}

function pathFor(name: string): string {
  mkdirSync(DIR, { recursive: true });
  return join(DIR, name);
}

export function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(pathFor(name), 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJson(name: string, value: unknown): void {
  writeFileSync(pathFor(name), JSON.stringify(value), 'utf8');
}

export const storageStatePath = (role: string) => pathFor(`session-${role}.json`);

/**
 * The last TOTP counter this RUN has handed out for an email.
 *
 * Also on disk, and for the same reason: the API records the minted counter on
 * the portal user row, so a replacement worker that starts counting again from
 * nothing will offer a code the database has already retired.
 */
export function lastCounter(email: string): number {
  return readJson<{ counter: number }>(`totp-${encodeURIComponent(email)}.json`)?.counter ?? -1;
}

export function recordCounter(email: string, counter: number): void {
  writeJson(`totp-${encodeURIComponent(email)}.json`, { counter });
}
