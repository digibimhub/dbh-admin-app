/**
 * The E2E suite, headed and slowed down, so a person can follow it.
 *
 * `pnpm test:e2e` is the background validation: headless, every scenario, as
 * fast as the stack will go. This is the opposite — one story, paced so the
 * tab switches and panel changes are legible. It exists as a script rather
 * than an npm env prefix because `E2E_SLOWMO=350 playwright test` is not a
 * thing cmd.exe understands, and pnpm runs scripts through cmd on Windows.
 *
 *   pnpm test:e2e:demo                    the add-in journey
 *   pnpm test:e2e:demo --slow 1000        slower
 *   pnpm test:e2e:demo tests/e2e/orgs-journey.spec.ts
 *
 * `--slow` rather than an env var because this has to work from PowerShell
 * too, where `E2E_SLOWMO=1000 pnpm …` is not a command, it is an error. The
 * env var still wins if it is set, for anyone already in the habit.
 */
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);

/** Pull `--slow N` / `--slow=N` out of the args; the rest are spec paths. */
function takeSlow(args) {
  const rest = [];
  let slow;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slow') { slow = args[++i]; continue; }
    if (a.startsWith('--slow=')) { slow = a.slice('--slow='.length); continue; }
    rest.push(a);
  }
  return { slow, rest };
}

const { slow, rest } = takeSlow(argv);
const target = rest.length ? rest : ['tests/e2e/addin-journey.spec.ts'];

const child = spawn(
  'npx',
  ['playwright', 'test', '--headed', ...target],
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      E2E_SLOWMO: process.env.E2E_SLOWMO ?? slow ?? '350',
      // Leave the evidence behind. The point of watching a run is to inspect
      // what it made, and teardown would remove it a second after it finished.
      E2E_KEEP_DATA: process.env.E2E_KEEP_DATA ?? '1',
    },
  },
);

child.on('exit', (code) => process.exit(code ?? 1));
