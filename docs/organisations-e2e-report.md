# Organisations tab — end-to-end test report

Automated coverage of the Organisations tab, built and run against the live
stack: the real portal on :3000, the real API, a real Postgres, and a mock
Autodesk issuer for the add-in leg. Nothing is stubbed inside the API.

**Result: 108 passed, 0 failed, 1 skipped — 2.3 minutes.**
Baseline before the fixes below: 98 passed, 7 failed.

---

## What was built

109 tests across 9 files in `tests/e2e/`.

| File | Tests | Covers |
|---|---:|---|
| `orgs-matrix.spec.ts` | 57 | Input matrix: 25 organisation-create cases, 23 domain cases, update and suspend cases |
| `orgs-domains.spec.ts` | 11 | Add, normalise, every refusal, remove behind a reason + step-up |
| `orgs-lifecycle.spec.ts` | 10 | Edit, suspend, reactivate, step-up enforcement, viewer/support visibility |
| `orgs-list.spec.ts` | 8 | Columns, search, status filter, URL state, row-click, column menu, CSV, paging |
| `addin-flow.spec.ts` | 8 | Pre-existing add-in suite (kept green through the helper extraction) |
| `orgs-create.spec.ts` | 7 | Slug suggestion, validation, duplicate slug, cancel, dialog semantics |
| `orgs-rbac.spec.ts` | 4 | 3 roles × 15 mutating routes, plus reads staying open |
| `orgs-login.spec.ts` | 3 | The one real form login, wrong credentials, unauthenticated access |
| `orgs-journey.spec.ts` | 1 | The whole point of the tab, end to end |

### The journey test

One test does what the tab exists for, all through the browser except the last
step: create the organisation → register its domain → issue a licence with one
seat → **a real add-in sign-in on that domain is granted** → a second person is
held with `seats_exhausted` → remove the domain → a third is refused with
`domain_not_registered`, while the first member keeps working.

### On coverage of "all combinations"

Not exhaustive, deliberately. The browser specs cover one case per equivalence
class; forty variants through a rendered dialog costs forty page loads to
exercise the same two schemas. The 57-case matrix covers the classes
exhaustively at the boundary the dialog posts to — same schema, same route, same
error bodies. A gap in validation shows up there; a gap in the screen shows up
in the UI specs.

---

## Issues found

All four were found by the suite, and all four are fixed. Each has a test that
fails without its fix.

### 1. No authorization on any `/admin/*` route — HIGH

A **viewer** created an organisation (`201`) and registered a domain (`201`) by
calling the API directly.

`requireRole` was defined in `apps/api/src/middleware/auth.ts` and **called
nowhere in the codebase**. `/admin/*` had a rate limiter, a session check and
audit logging, and no permission check at all. The admin app's own
`permissions.ts` promised that "the API enforces authorization regardless" — it
did not. Hiding a button was the entire boundary.

Bounded by one thing: portal-user management was guarded inline
(`actor.role !== 'owner'`), so there was never an escalation-to-owner path.

**Fix.** The capability matrix moved to `packages/shared/src/index.ts` as the
authoritative copy. A new `requireCapability()` guards **27 mutating routes**
across organisations, domains, licences, users, devices, requests, panels and
roles. Reads stay open — a viewer sees everything and changes nothing.

### 2. Whitespace-only organisation name accepted — MEDIUM

`POST /admin/orgs` with `name: "   "` returned `201` and stored it. `PATCH`
accepted it too. `z.string().min(2)` counts spaces as characters.

Reachable from the interface, not just the API: the edit form's own
`minLength={2}` counts them as well, and `save()` did not trim — so an operator
could rename a customer to nothing and have it blank in every list, every audit
row and every renewal email, unfindable by search.

**Fix.** `z.string().trim().min(2)` on `createOrgSchema`, which `patchOrgSchema`
inherits. Slug and contact email trim too, so a pasted `" Acme "` is stored the
way it will be read.

### 3. Create dialog kept its draft after Cancel — LOW

Fill the dialog, press Cancel, reopen: the abandoned values were still there,
including a stale error from a slug clash the operator had walked away from.
State was reset only on a *successful* create. `DangerDialog` has always reset
on open; the two dialogs disagreeing was the bug.

**Fix.** Reset moved to a `useEffect` on `open`, matching `DangerDialog`.

### 4. Modal focused "Close" rather than the first field — LOW

`Modal.tsx` searched the whole panel for the first focusable element and always
found the header's Close button, because it comes first in the DOM. Every dialog
opened with focus on the way out of it.

**Fix.** Searches the dialog body first, falling back to the panel so a dialog
with no focusable content still traps focus.

---

## Open items

Neither was changed on the test author's own judgment.

- **The skipped test.** `signing in for real` passes on a cold API but skips once
  the five-per-fifteen-minutes login budget for that email is spent, which
  repeated runs do. The limiter is in memory; restarting the API clears it. A
  skip is not a pass — on a cold API this should actually run.
- **The capability matrix is duplicated.** The admin app has no dependency or
  path mapping for `@app/shared`, and adding one would pull zod into the browser
  bundle for one table, so the UI keeps a mirror. `orgs-rbac.spec.ts` catches
  drift by asking the routes rather than reading either table. Collapsing to one
  copy is a build-config decision.
- **Observation, not a defect.** The login page shows the same generic message
  for a `429` as for a wrong code. That is deliberate — one message for every
  failure avoids a two-step oracle — but it does mean a rate-limited operator is
  told to check credentials that are fine.

---

## Running it

```
pnpm dev                                    # portal :3000, api :3001

npx playwright test                         # everything, headless
npx playwright test tests/e2e/orgs-*.spec.ts --headed
npx playwright test tests/e2e/orgs-journey.spec.ts --headed   # best one to watch
```

The suite reseeds the database before every run, so it is destructive to
whatever is in the local one and re-runnable without cleanup. Do not run
`pnpm build` while `pnpm dev` is up.

---

## Harness traps worth knowing

Three cost real debugging time and are documented in the helpers, because
anything added to this suite will hit them again.

1. **Playwright restarts the worker after every failure.** Anything memoised in
   module scope dies with it — including a portal login, which then repeats and
   exhausts the five-per-fifteen-minutes budget, turning one failure into a
   cascade of unrelated 429s. Sessions now persist to disk
   (`tests/e2e/helpers/state.ts`), cleared by global setup.
2. **`fill()` respects `maxlength`.** The authenticator boxes are
   `maxLength={1}`, so filling the first with six digits leaves one digit behind
   and the confirm button correctly stays disabled. The code must be *typed*.
   `enterTotp` now asserts each digit landed.
3. **The login page prefills the code** from `/admin/auth/dev-hint` in local dev,
   and a full `maxlength=1` box silently swallows a keystroke. The boxes are
   cleared before typing.

Plus one product constraint the suite is shaped around: TOTP codes are
single-use — the API records the minted counter — and that row is shared by both
API instances, so `freshTotp` tracks counters per email and waits out a window
rather than replaying one.
