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

## The mock add-in — `tests/mock-addin`

A web mock of the Revit ribbon, driven by `addin-journey.spec.ts`. It renders
what the API returns and decides nothing itself: every panel is a membership test
against the `scopes` array the API signed.

Four groups over the six catalogue slugs, which are compiled into shipped DLLs
and cannot be renamed:

| Group | Slugs | Visible to |
| --- | --- | --- |
| Protect | `troubleshoot` | admin |
| Review | `coordination`, `parameters`, `excel` | admin, coordinator |
| Produce | `cleanup` | everyone |
| General | `general` (never gated) | everyone, always — it carries Sign in |

### How its sign-in works

It does the `/v1` calls **server-side**, because the API's CORS allowlist is the
portal origin only and does not accept `x-device-hash`. A browser page on
127.0.0.1:4600 therefore cannot call `/v1` at all. The browser only navigates:

```
POST /__signin (same origin)  ->  mock tells the issuer who is signing in,
                                  then POSTs /v1/auth/start with
                                  redirectPort = its own port
browser -> authorize (:4599) -> 302 -> :3002/v1/auth/callback
        -> 302 -> 127.0.0.1:4600/callback?result=…&handoff=…
             -> mock POSTs /v1/auth/exchange, stores the grant, renders
```

That is what the real add-in does — open a browser, catch the redirect on a
loopback listener — so this process **is** that listener.

`POST /__refresh` is the daily check (`/v1/token/refresh`), surfaced as the
"Check licence" button. `GET /__state` returns the grant as JSON.

Click through it by hand with `pnpm mock:addin`, but note it defaults to the
E2E api on :3002, which only exists while Playwright is running.

## Cleaning up after a run

`globalTeardown` deletes the organisations the run created — tracked ids only,
never a `LIKE 'E2E%'` sweep, because several matrix cases are deliberately named
`Ab`, `Min Slug` and two hundred x's, and a pattern wide enough to catch those
would catch a real customer.

**If your spec creates an organisation, track it.** `createOrg` does it for you;
after the Add organisation dialog, call `trackOrg(id)` with the id from the URL;
after a direct `POST /admin/orgs`, call `trackOrg(row.id)`.

`E2E_KEEP_DATA=1` skips teardown when a failure is worth inspecting. The demo
runner sets it, because the point of watching a run is to look at what it made.

## Rate limits are raised on a developer machine

`limits` in `apps/api/src/env.ts` gates every brute-force budget on `isDev`:
login is 100 per email (5 in production), `/admin/*` is 2000 per minute per IP
(120), and the account lockout trips at 50 failures (10). On localhost the
limiter only ever locks you out of your own laptop, and the portal shows the same
generic message for a 429 as for a wrong password.

Two consequences for tests. A UI-heavy spec no longer 429s whichever spec runs
next. And `orgs-login.spec.ts`'s skip-on-429 branch is now effectively dead
locally — which is the point: the report called out that "a skip is not a pass".

The **account lockout** still lives in `portal_users.locked_until`, so unlike the
in-memory limiter it survives an API restart. Clear it with `pnpm db:seed` or by
setting `failed_attempts = 0, locked_until = null`.

## Running a subset

```bash
pnpm test:e2e tests/e2e/orgs-list.spec.ts
pnpm test:e2e --grep "suspend"
pnpm test:e2e --headed --debug
```

Traces are retained on failure, screenshots taken on failure.
