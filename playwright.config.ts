import { defineConfig } from '@playwright/test';

/**
 * The suite drives a RUNNING stack — `pnpm dev` in another terminal — plus the
 * mock issuer, which it starts itself.
 *
 * It is deliberately not wired to boot the API and the portal: they share
 * `apps/admin/.next` with the dev server, and starting a second one on top of
 * a running `next dev` is the failure AGENTS.md documents (every page 500s
 * with `Cannot find module './NNN.js'`).
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // Setup truncates before the run; this removes what the run created after it,
  // so the database a developer comes back to is the seeded one.
  globalTeardown: './tests/e2e/global-teardown.ts',
  // Serial. The specs share one seeded database and assert on seat counts, so
  // two of them running at once would race over the same seats.
  workers: 1,
  fullyParallel: false,
  // A failed E2E here means a real regression; retrying would only hide a
  // flake that is worth seeing.
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_ADMIN_URL ?? 'http://localhost:3000',
    // Nonzero only for the demo runner, which is there to be watched. Every
    // Playwright action pauses by this much, so it is a debugging aid, not a
    // fix for a flaky wait.
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  /**
   * The mock issuer, and an API instance pointed at it.
   *
   * The second API is deliberate: `.env` may hold real Autodesk credentials
   * and the developer's own API on :3001 should keep talking to Autodesk. The
   * override lives in this process's environment, never in a file, so nothing
   * about the checked-out repo changes when the suite runs.
   *
   * A second *portal* would not be safe — it shares `apps/admin/.next` with
   * `next dev`, which is the failure AGENTS.md documents — so the browser test
   * uses the portal already running on :3000.
   */
  webServer: [
    {
      command: 'node tests/mock-aps/server.mjs',
      url: 'http://127.0.0.1:4599/__health',
      reuseExistingServer: true,
      stdout: 'ignore',
    },
    {
      command: 'npx tsx apps/api/src/index.ts',
      url: 'http://127.0.0.1:3002/health',
      reuseExistingServer: false,
      stdout: 'pipe',
      env: {
        API_PORT: '3002',
        API_PUBLIC_URL: 'http://localhost:3002',
        APS_CALLBACK_URL: 'http://localhost:3002/v1/auth/callback',
        APS_AUTH_BASE: 'http://127.0.0.1:4599/authentication/v2',
        APS_USERINFO_URL: 'http://127.0.0.1:4599/userinfo',
        // Nothing scheduled: the suite asserts on counts, and a job firing
        // mid-run would move them underneath it.
        ENABLE_JOBS: 'false',
      },
    },
    /**
     * The mock ribbon, which is also the add-in's loopback listener.
     *
     * Safe to adopt an already-running one (`pnpm mock:addin`) because it holds
     * only the current sign-in, and the first thing any spec does is sign in.
     * It is pointed at the E2E API on 3002, not the developer's own on 3001.
     */
    {
      command: 'node tests/mock-addin/server.mjs',
      url: 'http://127.0.0.1:4600/__health',
      reuseExistingServer: true,
      stdout: 'ignore',
      env: {
        MOCK_ADDIN_PORT: '4600',
        E2E_API_URL: 'http://localhost:3002',
        MOCK_APS_URL: 'http://127.0.0.1:4599',
      },
    },
  ],
});
