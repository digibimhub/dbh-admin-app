# Project rules for code agents

Read `README.md` first. These rules apply to every session.

## Scope

This repo is the admin portal, API, and database. Do not start the
Revit add-in retrofit here. That is a separate application.

## Local environment — read before running anything

- **Docker is not installed on this machine, and neither is WSL.** Postgres
  runs from `pnpm db:up`, which puts the official PG16 binaries in `.localdb/`
  and starts them as a user process on 127.0.0.1:5432. Do not tell anyone to
  run `docker compose up`; it will fail. `docker-compose.yml` stays in the repo
  for teammates and CI only.
- **Node and pnpm are not on the sandboxed PATH.** Prefix shell commands with:
  `export PATH="/c/Program Files/nodejs:/c/Users/Admin/AppData/Local/Microsoft/WinGet/Packages/pnpm.pnpm_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"`
- **Every source file uses CRLF.** Exact-string edits must account for it, or
  they will silently fail to match.
- Files under `scripts/` are compiled as **CommonJS** — the root package.json
  has no `"type": "module"`. No top-level `await` there; wrap in a `main()`.
- Never start a long-lived server with inherited stdio from a script. The
  child keeps the pipe open and the caller hangs forever after a successful
  start (this bit `db-up.mjs` once already).
- **Do not run `pnpm build` while `next dev` is running.** They share
  `apps/admin/.next`, so the production build replaces the chunks the dev
  server has already mapped in memory, and every page then 500s with
  `Cannot find module './NNN.js'`. It looks like a broken import and is not.
  Stop dev first, or recover with: stop dev, delete `.next`, restart.
- `pnpm smoke` spends 4 of the 5-per-15-minutes-per-email login budget. Two
  runs inside one window trip the rate limiter; restart the API (the limiter
  is in-memory) rather than concluding login is broken.

## Database

### Rebuild mode is OVER — read this first

The trigger was documented as "the first commit or tag, or the first database
another person uses, whichever comes first". **The first commit has happened.**
`0000_violet_saracen.sql` is committed history now, and the rules below are the
permanent ones.

**Do NOT run `pnpm db:rebuild` again.** It drops both schemas and deletes every
generated migration — against a committed baseline that is destroying history
somebody else may already have applied. The script still exists and still
works, which is exactly why this warning is at the top rather than the bottom.

A schema change is now: edit `packages/db/src/schema/*.ts` → `pnpm db:generate`
→ review the SQL → `pnpm db:migrate`.

<details>
<summary>What rebuild mode was, for context</summary>

Before the first commit there was no history to protect, so a schema change did
not get its own migration: `db:rebuild` dropped the `public` and `drizzle`
schemas, deleted every generated migration, regenerated a single `0000`
baseline and reseeded — leaving exactly one migration file that always matched
the schema. Both schemas had to go, not just `public`, because
`__drizzle_migrations` lives in the `drizzle` schema and leaving it makes a
regenerated baseline look already-applied.

Nothing was lost by regenerating, because everything Drizzle cannot emit — the
`pgcrypto` and `citext` extensions, `set_updated_at()` and the updated_at
triggers — lives in `packages/db/src/migrate.ts` and is re-applied on every
migrate rather than baked into the SQL. That is still true.
</details>

### Never violate

1. NEVER edit a migration in `packages/db/drizzle/` that has been applied.
   Generate a new one instead. Migrations are append-only history.
2. NEVER run raw DDL against the database. All changes go through
   `packages/db/src/schema/*.ts` then `pnpm db:generate`.
3. NEVER use `drizzle-kit push` outside local dev — it skips migration history.
4. ALWAYS show the generated SQL and explain it before applying.
5. For DROP, RENAME, or adding NOT NULL to an existing column: STOP and use
   expand-contract.
6. Regenerate seed data if a change breaks it.

### Always

- Schema changes go through `packages/db/src/schema/*.ts`. Never hand-write DDL
  against a running database — the schema file is the single source of truth
  and the generated migration is its record.
- Show the generated SQL before applying it.
- `pnpm db:seed` (demo world) and `pnpm db:reset` (bootstrap rows only) are two
  different amounts of destruction. Know which one you are asking for.
  `pnpm db:rebuild` is a third and is now off-limits — see the top of this
  section.

## Identity model — the core invariant

- Identity comes ONLY from Autodesk, verified server-side during the OAuth
  code exchange. NEVER reintroduce Windows domain SID, AD object GUID, Entra
  tenant, or any machine-asserted signal into an access decision.
- `org_users.autodesk_id` is UNIQUE GLOBALLY. One person, one org. Moving
  someone between orgs is an explicit `user.transfer` action.
- **`org_domains.value` IS globally unique** (`uniq_domain_global`). A domain
  belongs to exactly one organisation, so resolution has one answer or none.
  **This reverses the earlier rule** — the old schema allowed two orgs to claim
  one domain and denied with `multiple_orgs`, which no longer exists. Do not
  reintroduce either. Registering a taken domain is a `409` naming the holder.
- `devices` is analytics only. It may gate on `status = 'disabled'`, nothing more.

## Roles and seats

Roles are DATA, not an enum. See `docs/roles-and-seats.md`.

- `roles.key` is immutable and is what everything references: `org_users`,
  `license_roles`, and the `role` claim on the token. `roles.name` is the
  mutable display string and the only thing any screen renders. That split is
  the whole reason roles are a table — renaming one rewrites a single column.
- `patchRoleSchema` deliberately omits `key`. Never add it.
- Retire a role with `is_active = false`, NEVER `DELETE` — a deleted role
  orphans every historical member row that referenced it.
- **Seat occupancy is COUNTED, never stored:**
  `count(*) FROM org_users WHERE org_id = ? AND role_key = ? AND status = 'active'`.
  That is what makes a role change correct for free — one statement frees the
  old seat and takes the new one. Do not add a counter column.
- Seats gate BECOMING active in a role. They never revisit a grant already
  made, so lowering a count below occupancy is allowed and evicts nobody.
- A full role does not reject a person: they become a member of the right
  organisation with the right role and `status = 'pending'`, and validation
  denies with `seats_exhausted`. Their session stays valid, so freeing a seat
  releases them with no re-authentication.

## Scopes

The add-in gates features on SCOPES and never on a role. See `docs/scopes.md`.

- `panel_definitions` is the catalog of scope slugs. Roles grant from it
  (`roles.scopes`); a licence may override the grant per role
  (`license_roles.scopes`, null means "use the role's list").
- Keep slug strings stable — they are compiled into shipped DLLs. The catalog
  is the six real ribbon panels: `cleanup`, `parameters`, `excel`,
  `coordination`, `troubleshoot`, `general`, mirroring `Panels` in the add-in's
  `RibbonBuilder.cs`. Append-only.
- `panel_definitions.never_gated` marks a scope granted to everybody whatever
  their role or licence. `general` carries About, Updates and Sign in, so a
  licensing failure that could hide it would also remove the means of fixing
  it. It is unioned in inside `resolveScopes()` — at the single point every
  grant passes through — so no configuration can drop it. Do not move that
  check into a route's validation, which is where it previously had holes.
- `neverGated` is settable when creating a panel and deliberately absent from
  the patch schema. It describes the shipped ribbon, not an operator
  preference; changing it takes a migration, which is the right friction.

## Code

- All shared types from `packages/shared`. No `any`.
- The QR encoder exists twice on purpose: `packages/core/src/qr.ts` and
  `apps/admin/src/lib/qr.ts`. `apps/admin` has no workspace dependencies, and
  `@app/core`'s barrel re-exports `crypto.ts`, which imports `@node-rs/argon2`
  — a native binary. `QrCode.tsx` is a client component, so importing from
  `@app/core` would pull a `.node` file into the browser bundle. Do NOT
  "deduplicate" these. `qr.drift.test.ts` fails if they diverge; core is
  strictly the admin file plus `qrToTerminal`.
- Every mutation writes `audit_log` with before/after state, via middleware.
- Deny responses use the codes in `packages/core/src/resolve.ts` (`DenyCode`),
  returned as HTTP 200 with a structured body.
- Rate limit every public endpoint.
- NEVER log tokens, passwords, TOTP codes, or APS credentials.
- Any change to `resolve.ts` requires tests. Run `pnpm --filter @app/core test`.
- Route params that reach a uuid column go through `uuidParam()`
  (`apps/api/src/lib/params.ts`). Postgres raises on a bad uuid literal, and a
  raw driver error becomes a 500 — "the server is broken" instead of "that is
  not an id".

## Add-in sessions — do not sign people out

A Revit user losing their session mid-model is worse than almost any other
failure here. See `docs/addin-auth.md`.

- Refresh tokens rotate on every successful validation, and the previous hash
  is kept with a **60-second replay window**. A stale token inside that window
  gets a normal rotation; outside it, the session is revoked as theft. Do NOT
  "simplify" this to revoke-on-any-stale-token: a dropped reply is far more
  common than a stolen token, and strict rotation turns every one into a forced
  sign-in.
- `expires_at` slides forward on each refresh; `max_lifetime_at` is fixed at
  issue and is the horizon a stolen token cannot outlive.
- **A denial never rotates or revokes.** An expired licence, a suspended org, a
  withdrawn seat — all return a structured deny while the session stays valid,
  so fixing the cause restores access at the next check with no re-login.
- A 5xx or a timeout is not an authorisation answer. That is what `grace_days`
  and `offlineGraceExceeded` (measured from last SUCCESS, not token expiry)
  exist for.

## Testing the add-in flow

`APS_AUTH_BASE` and `APS_USERINFO_URL` are overridable so `pnpm test:e2e` can
run the REAL sign-in code against a local OIDC issuer (`tests/mock-aps/`). The
mock verifies PKCE and client credentials itself; nothing inside the API is
stubbed or skipped.

- `assertApsHostsAreAutodesk()` in `apps/api/src/env.ts` refuses to boot when
  `NODE_ENV=production` and any APS endpoint points outside `autodesk.com`.
  Never add a bypass flag, and never add a `dev-login` route — a forgery path
  that exists but is "switched off" is one environment variable from being on.
- `pnpm test:e2e` **reseeds the database** before it runs, and starts its own
  API on :3002 so the developer's own API keeps its real Autodesk config. It
  needs `pnpm dev` running for the portal on :3000.
