/**
 * The E2E suite, headed and slowed down, so a person can follow it.
 *
 * `pnpm test:e2e` is the background validation: headless, every scenario, as
 * fast as the stack will go. This is the opposite — one story, paced so the
 * tab switches and panel changes are legible. It exists as a script rather
 * than an npm env prefix because `E2E_SLOWMO=350 playwright test` is not a
 * thing cmd.exe understands, and pnpm runs scripts through cmd on Windows.
 *
 *   pnpm test:e2e:demo                    the product demo, recorded
 *   pnpm test:e2e:demo --slow 1000        slower
 *   pnpm test:e2e:demo --addin            the add-in journey, with the ribbon
 *   pnpm test:e2e:demo tests/e2e/orgs-journey.spec.ts
 *
 * `--slow` rather than an env var because this has to work from PowerShell
 * too, where `E2E_SLOWMO=1000 pnpm …` is not a command, it is an error. The
 * env var still wins if it is set, for anyone already in the habit. `E2E_DEMO`
 * is set here for the same reason: it is what makes the `demo` project in
 * playwright.config.ts exist at all, and nobody should have to spell it out on
 * a Windows command line.
 *
 * The default is now the product demo — the whole walkthrough, and the only
 * spec that records video, which lands under `test-results/demo/`. The
 * narration to read over it is `docs/product-demo.md`. The add-in journey this
 * used to default to is still one flag away.
 */
import { spawn } from 'node:child_process';

const PRODUCT_DEMO = 'tests/e2e/product-demo.spec.ts';
const ADDIN_JOURNEY = 'tests/e2e/addin-journey.spec.ts';

const argv = process.argv.slice(2);

/**
 * Pull our own flags out of the args; whatever is left goes to Playwright.
 *
 * `rest` is spec paths in the normal case, but a stray `--grep` survives it
 * too, which is deliberate — the point of the passthrough is that anything
 * Playwright accepts still works.
 */
function takeArgs(args) {
  const rest = [];
  let slow;
  let addin = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slow') { slow = args[++i]; continue; }
    if (a.startsWith('--slow=')) { slow = a.slice('--slow='.length); continue; }
    if (a === '--addin') { addin = true; continue; }
    rest.push(a);
  }
  return { slow, addin, rest };
}

const { slow, addin, rest } = takeArgs(argv);
const target = rest.length ? rest : [addin ? ADDIN_JOURNEY : PRODUCT_DEMO];

/*
 * Which project to run under.
 *
 * The demo spec lives in the `demo` project and is ignored by `e2e`, so asking
 * for the file without the project would match nothing at all and report a
 * cheerful zero tests. Pick it from what was asked for: anything else — the
 * add-in journey, a path somebody typed, a bare `--grep` — belongs to `e2e`.
 */
const project = target.some((a) => a.includes('product-demo')) ? 'demo' : 'e2e';

const child = spawn(
  'npx',
  ['playwright', 'test', '--headed', `--project=${project}`, ...target],
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      E2E_SLOWMO: process.env.E2E_SLOWMO ?? slow ?? '350',
      // Declares the `demo` project. Harmless for an `e2e` run — an unused
      // project costs nothing — and required for a recorded one.
      E2E_DEMO: '1',
      // Leave the evidence behind. The point of watching a run is to inspect
      // what it made, and teardown would remove it a second after it finished.
      E2E_KEEP_DATA: process.env.E2E_KEEP_DATA ?? '1',
    },
  },
);

child.on('exit', (code) => process.exit(code ?? 1));
