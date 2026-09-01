# Testing

## Prerequisites

`pnpm db:up` and `pnpm dev` running in another terminal. Ports **3002**, **4599**
and **4600** must be free; **3000** must be busy — the suite never starts its own
portal, because a second Next would corrupt the `.next` it shares with `pnpm dev`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm test` | 139 unit tests. No database, no servers. |
| `pnpm typecheck` | `tsc --noEmit` across all 5 packages. |
| `pnpm test:e2e` | All 110 E2E, headless. The background validation. ~3 min. |
| `pnpm test:e2e <file>` | One spec file. |
| `pnpm test:e2e --grep "seat"` | One theme, across files. |
| `pnpm test:e2e:headed` | Same, with a visible browser. |
| `pnpm test:e2e:demo` | The add-in journey, slowed down and tab-switching, to be watched. |
| `pnpm test:e2e:demo --slow 1000` | Slower still. Works in PowerShell, cmd and bash alike. |
| `pnpm test:e2e --headed --debug` | Step through with the Playwright inspector. |
| `pnpm smoke` | Wiring check against a running API. Repointable with `SMOKE_API=…`. Spends 4 of 5 logins. |
| `pnpm verify:resolver` | Real resolver against the real DB, always rolled back. Needs the seed. |
| `pnpm mock:aps` | Mock Autodesk issuer on :4599, by hand. |
| `pnpm mock:addin` | Mock Revit ribbon on :4600, by hand. Wants the E2E api on :3002. |

## Database state

| Command | Leaves you with |
| --- | --- |
| `pnpm db:seed` | 3 orgs, 3 portal users, 10 people, 9 devices. The demo world. |
| `pnpm db:clean` | One operator (`admin@yourco.local`) + roles, panels, blocked domains. No business data. |
| `pnpm db:reset` | Catalogues only — **nobody can sign in** until `pnpm admin:create-user`. |
| `pnpm db:up` / `db:down` | Start/stop local Postgres on :5432. |
| `pnpm db:psql` | A psql shell on it. |

Add `-- --yes` to skip the prompt on `db:clean` and `db:reset`. All three refuse
to run against a `DATABASE_URL` that is not on localhost, and there is no
override flag.

**Never `pnpm db:rebuild`** — it drops committed migration history. See AGENTS.md.

## Environment flags

Set these the way your shell wants. PowerShell is `$env:NAME=1; pnpm …`, not
`NAME=1 pnpm …` — which is why the knob you actually reach for, `--slow`, is a
flag rather than a variable.

| Flag | Effect |
| --- | --- |
| `E2E_SLOWMO` | Pause between Playwright actions. `test:e2e:demo` sets 350; `--slow N` is the portable way to change it. |
| `E2E_KEEP_DATA=1` | Skip teardown, so a run's data survives for inspection. |
| `KEEP_PORTAL_EMAIL=…` | Which operator `db:clean` keeps. |
| `SMOKE_API=…` | Point `pnpm smoke` at a deployment. |

## Cleanup

A run deletes the organisations it created, by tracked id — never by name
pattern, since matrix cases are deliberately called `Ab`, `Min Slug` and two
hundred x's. **If your spec creates an organisation, track it**: `createOrg`
does it for you; otherwise call `trackOrg(id)`.

## Credentials

`admin@yourco.local` / `localdev-password`, code from `pnpm totp` (or the hint on
the login page). Codes are single-use and last 30s. Login is 5 per email per 15
minutes, in memory — **restart the API to clear it**, and treat "That did not
work" as possibly a 429.

More detail in `.claude/skills/testing-e2e/SKILL.md`.
