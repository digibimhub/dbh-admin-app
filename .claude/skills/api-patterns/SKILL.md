---
name: api-patterns
description: How routes are written in apps/api — Hono structure, the session/capability/step-up guards, zod schemas in @app/shared, error helpers, audit logging, rate limiting and param validation. Load before adding or changing any admin API route or middleware.
---

# API route patterns

Hono + Drizzle. Routes in `apps/api/src/routes/admin/*.ts`, each exporting a
`new Hono()` mounted in `apps/api/src/index.ts`.

## Anatomy of a route file

```ts
import { Hono } from 'hono';
import { and, eq, ilike } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { createOrgSchema, orgQuerySchema } from '@app/shared';
import { notFound, conflict } from '../../lib/errors';
import { uuidParam } from '../../lib/params';
import { requireCapability, requireStepUp } from '../../middleware/auth';
import { audit } from '../../middleware/audit';

export const organizations = new Hono();

organizations.get('/', async (c) => { … });
organizations.post('/', requireCapability('org.create'), async (c) => { … });
```

## Authorization

Three layers, all in `apps/api/src/middleware/auth.ts`:

- **`requireSession`** — applied globally to `/admin/*`. `PUBLIC_ADMIN` exempts
  `/admin/auth/login` and `/admin/auth/dev-hint`.
- **`requireCapability(cap)`** — put this on **every mutating route**. Reads are
  deliberately not gated: a `viewer` is a role that sees everything and changes
  nothing, so the boundary belongs on the writes. It throws 403 naming the
  missing capability — that is an authenticated operator being told which
  permission they lack, not an anonymous caller being handed a map.
- **`requireStepUp(c)`** — call inside a handler for privileged mutations. It
  demands a re-auth within the last 5 minutes (`last_reauth_at` on the claims);
  the portal answers the resulting 403 by prompting for a code and calling
  `stepUp()`.

`requireRole(...roles)` still exists but prefer capabilities.

The matrix lives once in `packages/shared/src/index.ts` (`CAPABILITIES`,
`CAPABILITY_MATRIX`, `can()`) and is **mirrored** in
`apps/admin/src/lib/permissions.ts` so the screen hides exactly what the route
would refuse. Add a capability in both places.
`tests/e2e/orgs-rbac.spec.ts` walks every role against the real routes.

> Hiding a button is not a permission. Before `requireCapability` existed,
> `/admin/*` was guarded by a session check and nothing else — every
> authenticated portal user, viewer included, could create organisations and
> issue licences by calling the API directly.

## Validation

Schemas live in `packages/shared/src/index.ts` and are shared with the portal.
Parse at the top of the handler:

```ts
const body = createOrgSchema.parse(await c.req.json());
```

A `ZodError` becomes a 400 `validation_error` in the error handler — do not
catch it yourself. Prefer `z.string().trim().min(2)` over `.min(2)`: without the
trim, `"   "` is a valid name and gets stored.

Route params never go straight into a query:

- **`uuidParam(c)`** for anything compared against a uuid column. Postgres raises
  on an invalid uuid literal, so without it a typo'd URL is a 500, not a 400.
- **`requiredParam(c, 'key')`** for non-uuid segments (a role key, a panel slug).
  Adding a guard in front of a handler widens `c.req.param()` to
  `string | undefined`; this narrows it without a cast.

## Errors — `apps/api/src/lib/errors.ts`

`HttpError(status, code, message, fields?)`, with helpers:

| Helper | Status / code |
| --- | --- |
| `unauthorized()` | 401 `unauthorized` |
| `invalidCredentials()` | 401 `invalid_credentials` |
| `forbidden()` | 403 `forbidden` |
| `notFound()` | 404 `not_found` |
| `conflict(msg)` | 409 `conflict` |
| `badRequest(msg, fields?)` | 400 `bad_request` |

Throw them; never `c.json({error})` by hand. `fields` maps a field name to a
message so a form can mark the offending input.

**Auth routes are the exception to helpful errors.** Every failure in
`/admin/auth/login` — no such user, wrong password, wrong code, reused code,
locked account — throws the same `invalidCredentials()`, and each one spends the
same argon2 work via `dummyPasswordVerify()` so response timing does not reveal
which addresses have accounts.

## Audit

```ts
await audit(c, {
  action: 'org.create',
  targetType: 'organization',
  targetId: org.id,
  before, after,
});
```

Actor and IP come from the context automatically; unauthenticated routes pass
`actorId`/`actorEmail` explicitly. Pass a transaction as the third argument to
write the audit row inside the same transaction as the change.
`auditMutations` warns about a successful mutation that wrote no audit row —
if you add a mutating route, audit it.

## Rate limiting — `apps/api/src/middleware/ratelimit.ts`

`rateLimit(n, windowMs)` as middleware, or `consumeRateLimit(bucket, key, windowMs, max)`
inside a handler. `clientIp(c)` for the IP.

It is **in-memory per process**: it does not survive a restart and is not shared
across instances. Login is 5 per email and 20 per IP per 15 minutes, counted
*before* any database work so a flood cannot be used to probe timing.

## Database

`import { db, schema as s } from '@app/db'`, Drizzle query builder. Two habits
this codebase keeps:

- **Count, do not tally.** Occupancy is a `COUNT` grouped by role, never a stored
  number — which is what makes moving a person between roles correct with no
  bookkeeping.
- **Return what the list needs in one query.** The organisations list carries its
  licence and people counts through one left join and grouped counts, rather than
  a second request the browser joins by hand.

Retirement is `is_active = false`, never `DELETE` — a deleted row orphans the
history that referenced it.

## Two role vocabularies — do not conflate them

- **Portal roles** — `owner | admin | support | viewer`, a pg enum on
  `portal_users`, defaulting to `viewer`. These drive `requireCapability`.
- **Org member roles** — the `roles` table, data rather than an enum so an
  operator can add one without a deploy. `key` is immutable and is what
  `org_users`, `license_roles` and the add-in token's `role` claim reference;
  `name` is the mutable display string and the only thing screens render.
  Exactly one row may be `is_default` (currently `user`), granted on
  auto-provision.

## Checklist for a new mutating route

1. `requireCapability('…')` in the route definition, capability added to both
   matrices.
2. `schema.parse()` on the body, `uuidParam`/`requiredParam` on the segments.
3. `requireStepUp(c)` if it is privileged.
4. Throw the error helpers, never raw responses.
5. `await audit(c, {...})` before returning.
6. `pnpm typecheck`, then a spec in `tests/e2e/`.
