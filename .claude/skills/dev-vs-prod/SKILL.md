---
name: dev-vs-prod
description: What differs between local development and production — the dev auth hint, TOTP enrolment vs the shared dev secret, Turnstile, cookie flags, encryption and signing keys, and how to smoke-test a deployed environment. Load before changing auth behaviour, touching env handling, or verifying a production deployment.
---

# Local development vs production

The switch is `env.isDev` in `apps/api/src/env.ts`:
`NODE_ENV !== 'production'`. A handful of behaviours hang off it, and off
`DEV_AUTH_HINT`.

## How OTP login works in local development

Everyone shares one known secret. `packages/db/src/seed/index.ts` writes
`totpSecretEnc: encryptAtRest('JBSWY3DPEHPK3PXP')` — the RFC 4226 test vector —
for all three seeded portal users, with `totpEnabled: true`.

`GET /admin/auth/dev-hint` then hands the login page the credentials outright:

```ts
if (!env.isDev || !env.devAuthHint) return c.json({ enabled: false });
return c.json({ enabled: true, email, password, totp: currentTotp(DEV_TOTP_SECRET) });
```

Requires **both** `NODE_ENV != production` and `DEV_AUTH_HINT=true`. The login
page prefills email, password and the code from it, and prints
`Local dev hint — current code: …`.

**The code is live for ~30 seconds.** Two independent things retire it:

1. `verifyTotp` allows `window: 1`, so ±1 step of skew and no more.
2. `verifyTotpWithReplay` refuses any counter `<= portal_users.last_totp_counter`.
   A code is **single-use** — once spent, it stays dead even inside its window.

So a hint that is not re-fetched is a hint that lies, and every failed attempt
spends one of five per email per fifteen minutes. `pnpm totp` (`--watch`) prints
the current code from the terminal instead.

Other ways in locally: `pnpm db:seed` (the demo world above), `pnpm db:reset`
(bootstrap catalogs only — nobody can log in), or `pnpm admin:create-user` for a
real account with a real authenticator.

## How OTP login works in production

There is no shared secret and no hint. `dev-hint` answers `{ enabled: false }`,
so the page prefills nothing and shows no code.

An operator is created with `pnpm admin:create-user`, which sets a password but
no TOTP. Their first sign-in takes the **enrolment** path:

1. Login with email + password and **no code**. `needsEnrol` is true when
   `!totpEnabled || totpResetRequired`, so the API issues a short-lived
   (30 min) `typ: 'enrol'` cookie and the portal redirects to `/login/totp-enrol`.
2. `POST /admin/auth/totp/enrol` generates a per-user secret and returns it with
   an `otpauth://` URL, rendered as a QR code. The secret is **not persisted** —
   it rides in the enrolment cookie, so an abandoned enrolment cannot lock
   anyone out, and someone who only saw the session cookie cannot read it.
3. The user scans it and confirms with a code. Only then is the secret sealed
   into `totp_secret_enc` and `totpEnabled` set.

After that, every sign-in needs email + password + a code from *their* device,
verified against the same ±1 window and the same replay guard.

**Recovery is operator-driven by design.** There is no self-service reset:
`pnpm admin:reset-totp` sets `totpResetRequired`, which puts the account back on
the enrolment path at its next sign-in. The login page says exactly this.

## The differences that bite

| Thing | Local | Production |
| --- | --- | --- |
| `dev-hint` | Enabled by `DEV_AUTH_HINT=true` | `{ enabled: false }` |
| TOTP secret | One shared seed secret | Per-user, enrolled by QR |
| Session cookie | `secure: false` | `secure: true` — **HTTPS required** |
| `ENCRYPTION_KEY` | Missing ⇒ ephemeral key generated per restart, with a warning | Missing ⇒ **refuses to start** |
| APS host overrides | Allowed, so tests can use a local issuer | `assertApsHostsAreAutodesk()` **refuses to boot** |
| Jobs | On unless `ENABLE_JOBS=false` | On |

Things that are **the same** in both, and are often mistaken for bugs: the
5-per-email / 20-per-IP / 15-minute login limiter (in-memory, cleared only by
restarting the API), the 10-failure 15-minute account lockout, and the single
generic error message for every credential outcome.

### Env vars that fail confusingly

- **`ENCRYPTION_KEY`** — rotate it after seeding and every stored TOTP secret
  becomes undecryptable. `openTotpSecret` returns `null`, login 401s, and the
  message says "check your code". Fix: reseed, or restore the key.
- **`JWT_PORTAL_SECRET`** — must be ≥32 chars. `packages/core/src/tokens.ts`
  reads `process.env` directly (the dev fallback in `env.ts` does not reach it),
  so a short or missing value passes password *and* TOTP and then throws at
  signing time — a 500 that the login page renders as a credential failure.
- **Turnstile** — `TURNSTILE_SECRET` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` must be
  set together or blank together. Secret without site key means the widget never
  renders, no token is sent, and every login fails verification.
- **`JWT_SIGNING_KEY_PEM` / `_PUBLIC_PEM`** — unset and `seedSigningKey()` skips
  *silently*; JWKS then serves an empty key set and add-in tokens cannot be
  verified. Generate with `pnpm keys:gen --write`.
- **`NEXT_PUBLIC_API_URL`** — Next reads `.env` from `apps/admin/`, not the repo
  root, and inlines `NEXT_PUBLIC_*` at build time. Changing it in the root `.env`
  does nothing; changing it at all needs a rebuild.

## Smoke-testing a deployed environment

`scripts/smoke.mjs` is the tool for this. It is deliberately dependency-free —
plain `fetch`, TOTP implemented inline, no workspace imports — **so it can be
pointed at any deployment**:

```bash
SMOKE_API=https://api.example.com \
SMOKE_EMAIL=operator@example.com \
SMOKE_PASSWORD='…' \
SMOKE_TOTP_SECRET='…' \
pnpm smoke
```

It proves the wiring rather than the logic: middleware order, cookie flags, Zod
rejection, JWKS actually carrying key material, and a login that really passes
argon2 + TOTP. Unit tests prove the logic; `pnpm verify:resolver` proves the SQL.

It spends **4 of the 5** login attempts for that email, so run it once per
fifteen-minute window per account, or point it at a dedicated smoke account.

`pnpm test:e2e` is **not** for production — its `globalSetup` truncates and
reseeds the database.

### Manual checks worth doing once against a new environment

1. `GET /health` → 200, and `GET /.well-known/jwks.json` → a non-empty `keys`.
2. `GET /admin/auth/dev-hint` → `{"enabled":false}`. If it returns credentials,
   `NODE_ENV` or `DEV_AUTH_HINT` is wrong — stop and fix that first.
3. Sign in and confirm `portal_session` carries `Secure` and `HttpOnly`.
4. Confirm CORS: the API allowlist is exact (`env.adminUrl` plus
   `http://localhost:3000`), so the portal's real origin must be `ADMIN_URL`.
5. Sign in as a `viewer` and confirm a mutating call 403s with
   `Your role does not allow this. Required capability: …` — that is
   `requireCapability` doing its job, not a UI bug.

## Running a production-shaped build locally

Stop `next dev` first — a production build and the dev server share
`apps/admin/.next`, and running both is the `Cannot find module './NNN.js'`
failure `AGENTS.md` documents.

```bash
# stop pnpm dev, then:
pnpm build
NODE_ENV=production pnpm --filter @app/api start   # needs real keys set
```

Expect `dev-hint` to go quiet and the session cookie to demand HTTPS — behind
plain `http://localhost` the browser will not store a `Secure` cookie, so
terminate TLS or test the API with `curl` instead.
