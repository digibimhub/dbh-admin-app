---
name: testing-e2e
description: How to run and write the Playwright end-to-end suite — the running-stack requirement, the reseed in global-setup, portal login helpers, the TOTP replay ledger and the login rate-limit budget. Load before running tests/e2e, adding a spec, or debugging an E2E login failure.
---

# End-to-end tests

`pnpm test:e2e` (= `playwright test`). Config: `playwright.config.ts`, specs in
`tests/e2e/`, helpers in `tests/e2e/helpers/`.

## Before you run it

**`pnpm dev` must already be running in another terminal.** The suite drives the
live portal on :3000 and does *not* start one — a second Next server would share
`apps/admin/.next` with `next dev`, which is the `Cannot find module './NNN.js'`
failure `AGENTS.md` documents.

What Playwright starts itself:

| Server | Port | Note |
| --- | --- | --- |
| Mock APS issuer | 4599 | `reuseExistingServer: true` |
| A second API | 3002 | `reuseExistingServer: false` — **port 3002 must be free**, or the run fails to boot |

The second API exists so `.env` can hold real Autodesk credentials while the
suite points at the mock issuer. The overrides (`APS_AUTH_BASE`,
`APS_USERINFO_URL`, `ENABLE_JOBS=false`) live in that process's environment only —
nothing in the checked-out repo changes when the suite runs.

Execution model: `workers: 1`, `fullyParallel: false`, `retries: 0`,
60 s timeout. Serial on purpose — the specs share one seeded database and assert
on seat counts.

## global-setup reseeds the database

`tests/e2e/global-setup.ts` runs `tsx packages/db/src/seed/index.ts`, which
**TRUNCATEs everything**, then calls `resetSharedState()`. Consequences:

- Any data you were looking at locally is gone after a run.
- Every portal user gets a new id, so a cached session from a previous run names
  somebody who no longer exists — that is what `resetSharedState()` clears.
- Counts asserted in specs are counts against the seed (3 organisations), so a
  half-finished run leaves the DB drifted until the next reseed.

## Logging in from a spec

Use `tests/e2e/helpers/portal.ts` — never drive the login form.

```ts
const api = await portalApi('owner');            // APIRequestContext, cached
const cookie = await sessionCookie('support');   // inject into a browser context
```

Three seeded roles, all sharing `localdev-password` and the RFC 4226 test secret
`JBSWY3DPEHPK3PXP`:

```
owner   admin@yourco.local
support support@yourco.local
viewer  viewer@yourco.local
```

`support@` and `viewer@` come from the seed. If they are missing, your database
predates that seed change — reseed.

Browser specs inject the `portal_session` cookie (see `helpers/fixtures.ts`)
rather than signing in. This works across ports because cookies are not
port-scoped and both API processes read the same root `.env`, so
`JWT_PORTAL_SECRET` matches.

## The two traps that make a login look "broken"

**1. TOTP codes are single-use.** The API stores `portal_users.last_totp_counter`
and rejects any counter `<= ` it as replayed — on top of the ±1 window skew. So a
code can be "currently valid" and still refused because this run already spent it.
`helpers/state.ts` keeps a per-email counter ledger in `%TEMP%/dbh-e2e-state` so
replacement workers do not re-spend a retired counter. `portalApi` retries by
sleeping to the next 30 s boundary — that is why, not flakiness.

**2. Login is rate limited: 5 per email per 15 minutes, 20 per IP.** The limiter
is in-memory per API process, so **restarting the API is the only reset**
(`resetRateLimits()` is test-only). `pnpm smoke` spends 4 of the 5 — two runs in
one window trip it. On screen a 429 is indistinguishable from a wrong code, so
read the status off the wire:

```ts
const [login] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/admin/auth/login')),
  page.getByRole('button', { name: 'Continue' }).click(),
]);
test.skip(login.status() === 429, 'the login rate limiter is hot for this email');
```

`tests/e2e/orgs-login.spec.ts` is the one spec that drives the real form, and is
named to sort **last** so it absorbs the remaining login budget.

## Typing a code into the UI

Use `enterTotp(page, code)` from `helpers/ui.ts`. Do not use `fill()` — the boxes
are `maxLength={1}` and `fill` inserts through `insertText`, leaving one digit
behind. The helper clears all six boxes first (the login page prefills them from
`/admin/auth/dev-hint` in local dev) and asserts each digit landed.

## Writing a new spec

- Name it `orgs-<thing>.spec.ts` and remember alphabetical order is execution order.
- Get auth from `portalApi(role)` / `sessionCookie(role)`; never a hardcoded cookie.
- Assert against the seeded world, and clean up rows you create if a later spec
  counts them.
- Prefer role-based locators (`getByRole`) — the DataTable and TotpInput both
  expose proper roles and labels.
- A failure here means a real regression: `retries: 0` is deliberate.

## Running a subset

```bash
pnpm test:e2e tests/e2e/orgs-list.spec.ts
pnpm test:e2e --grep "suspend"
pnpm test:e2e --headed --debug
```

Traces are retained on failure, screenshots taken on failure.
