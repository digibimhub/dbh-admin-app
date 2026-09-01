import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resetSharedState } from './helpers/state';

/**
 * Reseed before the suite runs.
 *
 * The E2E signs real people in, which creates real members and consumes real
 * seats. Without this the second run starts from the first run's leftovers —
 * Acme's user seats fill up and sign-ins that should be granted come back
 * `seats_exhausted`, which looks like a regression and is not one.
 *
 * Individual specs still restore what they change, so one spec can be re-run
 * on its own. This is the belt to that pair of braces: it guarantees the whole
 * suite starts from the state the seed describes.
 *
 * The seed truncates every table and rebuilds the demo world. It refuses to
 * run with NODE_ENV=production, and this is a local development database — but
 * it does mean the suite is destructive to whatever is currently in it.
 *
 * Resolved from `process.cwd()` rather than the module's own path: Playwright
 * transpiles this file to CommonJS (the root package.json has no
 * `"type": "module"`), so `import.meta` is a parse error here, and it always
 * runs with the config directory as the working directory.
 */
export default function globalSetup(): void {
  const root = process.cwd();
  process.stdout.write('  reseeding the database for a deterministic run…\n');

  execFileSync(
    process.execPath,
    [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'packages/db/src/seed/index.ts')],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  );

  // The reseed gives every portal user a new id, so a session cached by the
  // previous run names somebody who no longer exists. Clearing it here is also
  // what makes the cache safe to reuse across worker restarts within this run.
  resetSharedState();
}
