import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

type Project = NonNullable<PlaywrightTestConfig['projects']>[number];

/**
 * The recorded walkthrough, and the only thing in the repo that records.
 *
 * `video: 'on'` rather than `retain-on-failure`, because the file IS the
 * deliverable here — a demo that failed halfway is still the run somebody
 * wanted to look at. The size is pinned to the viewport: left alone, Playwright
 * scales a recording down to fit 800x800, and a 1440px-wide admin table comes
 * out of that unreadable.
 *
 * Its own `outputDir`, so the video is somewhere that can be named out loud and
 * deleted on its own, without taking the traces of a real failure with it.
 */
const demo: Project = {
  name: 'demo',
  testMatch: /product-demo\.spec\.ts/,
  outputDir: 'test-results/demo',
  use: {
    viewport: { width: 1440, height: 900 },
    video: { mode: 'on', size: { width: 1440, height: 900 } },
  },
};

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
   * Two projects, so exactly one file is recorded and nothing else is.
   *
   * `product-demo.spec.ts` is a narrated walkthrough meant to be watched, not
   * another regression: it re-proves what `orgs-journey` and `addin-journey`
   * already prove, it takes minutes, and it puts rows on the cross-organisation
   * screens that the counting specs assert against the seed. So the ordinary
   * project ignores the file outright — `pnpm test:e2e` runs exactly what it
   * ran before, at the same speed, and writes no video — and the demo gets a
   * project of its own that turns recording on and gives the browser a window
   * worth filming.
   *
   * That project is only DECLARED when `E2E_DEMO=1`. A `--project` filter would
   * not have been enough: `playwright test` with no filter runs every declared
   * project, so a demo project that always existed would attach itself to every
   * plain run. The switch is an env var rather than a flag for the same reason
   * `scripts/e2e-demo.mjs` exists at all — `E2E_DEMO=1 playwright test` is not
   * a command cmd.exe or PowerShell understands — so the runner sets it, and
   * `pnpm test:e2e:demo` is the supported way in. Asking for `--project=demo`
   * without it fails loudly with "project not found", which is the right kind
   * of wrong.
   *
   * `workers: 1` and `fullyParallel: false` stay above, where they govern both.
   */
  projects: [
    { name: 'e2e', testIgnore: /product-demo\.spec\.ts/ },
    ...(process.env.E2E_DEMO === '1' ? [demo] : []),
  ],
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
