# DIGIBIM HUB — Licensing Admin

Org-scoped licensing for Revit add-ins. Identity comes from Autodesk;
enforcement is a short-lived signed token the add-in verifies offline.

This repo is the **admin portal + API + database**. The Revit add-in
(`LicenseClient.dll`) is a separate application and is not built here.

## How access is decided

Three questions, in order. Each has its own screen.

1. **Which organisation?** Their verified Autodesk email domain must be
   registered. `org_domains.value` is globally unique, so a domain resolves to
   exactly one organisation or to none — there is never a tie to break.
2. **Is there room?** Seats live on the licence, per role. Auto-provisioning
   fills up to the count; past it the person still becomes a member, as
   `pending`, and is told they are waiting rather than turned away.
3. **What may they do?** Their role grants **scopes**. The add-in switches
   features on scopes and never on a role name, so a role can be renamed
   without touching a single workstation.

Roles are data, editable in **Settings → Roles**: `key` is permanent and is what
every row and every token references, `name` is free to change and is the only
thing any screen renders.

- [docs/roles-and-seats.md](docs/roles-and-seats.md) — why occupancy is counted
  and not stored, and what happens when a role is full
- [docs/scopes.md](docs/scopes.md) — the contract with the shipped DLL
- [docs/addin-auth.md](docs/addin-auth.md) — the security model, and why
  refresh-token rotation has a replay window

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm keys:gen --write     # ES256 keypair for add-in tokens, into .env
pnpm db:up                # Postgres 16 on :5432
pnpm db:migrate           # schema + extensions + updated_at triggers
pnpm db:seed              # 3 orgs, one per licence mode
pnpm dev                  # api :3001, portal :3000
```

Portal: http://localhost:3000
Login: `admin@yourco.local` / `localdev-password`
Print a TOTP code: `pnpm totp`

### Three database states

The demo dataset is useful for looking at a full portal and useless for
watching the real Autodesk flow populate one from nothing.

All three share `packages/db/src/seed/bootstrap.ts`, which is the single
definition of what a clean database contains.

| Command | Leaves you with | Log in as |
|---|---|---|
| `pnpm db:seed` | 3 orgs (standard, trial, internal), 10 people, 9 devices | `admin@yourco.local`, fixed dev TOTP |
| `pnpm db:reset` | `blocked_domains` (19), `panel_definitions` (6) and `roles` (3). Nothing else. | nobody, until you create a user |
| `pnpm admin:create-user` | one real portal account | that account, with a real authenticator |

`db:reset` refuses on `NODE_ENV=production`, names the database it is about
to empty, and asks before doing it. `--yes` skips the prompt for scripted
runs; a non-TTY without it refuses rather than assuming consent.

`admin:create-user` prints a scannable QR and **will not write the row until
you send a valid code back**. An account whose second factor never reached an
authenticator is the one failure that locks you out of the thing you just
built, so the CLI makes it unreachable. The accepted code is stored as spent,
so it cannot be replayed at the first login.

### Watching the real flow

```bash
pnpm db:reset             # empty but usable
pnpm admin:create-user    # scan the QR, confirm a code
pnpm dev
```

Log in with the real account — the dashboard renders zeros and no errors.
Add an organisation, register a domain you control, then `pnpm aps:login`
with an Autodesk account on that domain and watch `org_users`, `devices` and
`usage_daily` fill from nothing. `pnpm db:seed` puts the demo world back.

To watch the same flow without an Autodesk account at all, run `pnpm mock:aps`
and point the API at it — see [docs/addin-auth.md](docs/addin-auth.md).

### Changing the schema

```bash
# edit packages/db/src/schema/*.ts, then:
pnpm db:generate          # emits a new migration — read the SQL it produces
pnpm db:migrate           # applies it
```

Migrations are append-only history. Never edit one that has been applied, and
for a DROP, a RENAME or a new NOT NULL on an existing column, use
expand-contract.

**`pnpm db:rebuild` must not be run again.** It drops both schemas and deletes
every generated migration — which was the right thing before the first commit,
when there was no history to protect, and is destructive now that
`0000_violet_saracen.sql` is committed. The script still exists; the rule is in
[AGENTS.md](AGENTS.md), with the reason.

### Postgres without Docker

`pnpm db:up` downloads the official PostgreSQL 16 binaries into `.localdb/`
(once, ~130 MB) and runs the server as a plain user process on 127.0.0.1:5432
with the same credentials as the compose service. No Docker, no WSL, no
elevation, no reboot, and no Windows service is registered — `pnpm db:down`
stops it, deleting `.localdb/` removes it entirely. The script is idempotent,
so running it when the server is already up is a no-op.

`docker-compose.yml` is still the path for teammates and CI. Use whichever is
available; `DATABASE_URL` is identical either way. Mailpit only comes with
compose, so locally sent mail is logged rather than delivered.

| | `pnpm db:up` | `docker compose up -d` |
|---|---|---|
| Prerequisites | none | Docker Desktop + WSL2 |
| Mailpit on :8025 | no | yes |
| Isolation | user process | container |

## Checks

```bash
pnpm typecheck           # all 5 packages
pnpm test                # resolver, scopes, crypto, TOTP — no database needed
pnpm verify:resolver     # resolveUser against the SEEDED database
pnpm smoke               # wiring, against a running api
pnpm test:e2e            # the whole add-in flow, through a mock Autodesk
```

`verify:resolver` catches what unit tests cannot: a wrong WHERE clause, a
case-sensitive email comparison, or an upsert whose conflict target does not
match the unique index. It runs inside a transaction that is always rolled
back, so it is safe to re-run and leaves no rows behind.

`test:e2e` drives the real sign-in: a real PKCE authorization-code exchange, a
real ES256 token, real seat arithmetic. Only the identity provider is local
(`tests/mock-aps/`), and the API **refuses to boot in production** if its
Autodesk endpoints have been pointed anywhere else. It needs `pnpm dev` running
for the portal, starts its own API on :3002 so your own keeps its real Autodesk
config, and **reseeds the database** so the run is deterministic.

`pnpm smoke` spends 4 of the 5-per-15-minutes-per-email login budget. Two runs
in one window trip the limiter — restart the API (it is in memory) rather than
concluding login is broken.

## Layout

```
apps/api            Hono — add-in + admin endpoints, 4 scheduled jobs
apps/admin          Next.js admin portal
tests/              mock OIDC issuer + Playwright end-to-end suite
packages/db         Drizzle schema, migrations, seed
packages/core       resolveUser, tokens, crypto, TOTP, APS client
packages/shared     Zod schemas shared by API and UI
scripts/            portable Postgres, key generation, verification
```

## Status

Organisations, domains, licences and people are rebuilt around roles and seats,
and verified against a running stack:

| | |
|---|---|
| Schema | 17 tables, down from 22 |
| Typecheck | 5/5 packages clean, no `any` in the repo |
| Unit tests | 139 passing (resolver, scopes, crypto, TOTP, tokens, APS) |
| Resolver vs live SQL | 17 checks passing (`pnpm verify:resolver`) |
| Wiring | 30 checks passing (`pnpm smoke`), no skips |
| Add-in flow | 8 specs passing (`pnpm test:e2e`), re-runnable |

Seven tables went with the features that never read them — the audit is in the
git history of `packages/db/src/schema`. Three scheduled jobs went with them;
four remain.

**The Autodesk sign-in flow now runs end to end locally** against the mock
issuer in `tests/mock-aps/`, so it is no longer blocked on APS registration to
develop against. A real APS app is still needed before a real Autodesk account
can sign in — see [docs/APS-SETUP.md](docs/APS-SETUP.md).

**Not in this phase:** the Audit and Usage tabs on an organisation, and the
usage history that feeds them. The rollup tables were removed rather than left
filling up with rows nothing read; they return with the screen that needs them.

The Revit add-in (`LicenseClient.dll`) is a separate application — see the scope
rule in [AGENTS.md](AGENTS.md).
