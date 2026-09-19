---
name: cloud-db-local-run
description: How to run the local API and portal against the cloud (Neon) database without breaking production — the production keys that must be in .env first, the boot-time write to signing_keys that overwrote production's JWKS once, the jobs and dev hint to switch off, and the commands that must never run with a remote DATABASE_URL. Load before pointing DATABASE_URL at anything that is not localhost.
---

# Local API against the cloud database

`pnpm dev` runs no migrations on boot, so pointing `DATABASE_URL` at the cloud
database will not change its schema. It will still **write** to it, and one of
those writes can take production down. This is what has to be true first.

## The boot-time write that broke production once

`getSigningKey()` in `apps/api/src/lib/signing.ts` runs when the API starts and
**upserts the local public key into `signing_keys`** under `JWT_SIGNING_KID`
(`k2026a`). Production serves `/.well-known/jwks.json` from that same table
(`listPublicKeys()`), and it caches its own key in memory, so it does not write
the right key back until the Render service restarts.

On 2026-09-19 the local API was started with the local dev key pair and the
live JWKS served that key for several minutes. Every add-in token in the field
would have failed verification against it.

So before the API starts with a cloud URL, `.env` must carry **production's**
values from the Render environment of the API service:

| Variable | Why |
| --- | --- |
| `JWT_SIGNING_KEY_PEM` | The boot upsert then rewrites the row with the key production already uses — a no-op. |
| `JWT_SIGNING_PUBLIC_PEM` | Optional, but `getSigningKey()` refuses to boot if it does not match the private key, which catches a paste error. |
| `ENCRYPTION_KEY` | Portal users' TOTP secrets are AES-GCM under this key. With the wrong one `openTotpSecret` returns null and login fails with the generic "check your code". |

`JWT_PORTAL_SECRET` can stay the local one: portal cookies are only ever
verified by the API that issued them.

The PEMs can be written either as the escaped single-line form
(`"-----BEGIN…\n…\n-----END…\n"`) or as a quoted multi-line block; dotenv 16
reads both. Keep one copy of each, not both.

## Two more lines in `.env`

```
ENABLE_JOBS=false     # five cron jobs; `cleanup` fires at :45 every hour
DEV_AUTH_HINT=false   # the hint prefills admin@yourco.local, which does not exist there
```

Production already runs the jobs. A second runner on a laptop would mark
devices stale, prune usage rows and send digests against real data.

## Never run these with a cloud URL

| Command | Why |
| --- | --- |
| `pnpm db:seed` | Truncates and reseeds the demo world. No host check. |
| `pnpm db:reset` / `pnpm db:rebuild` | Refuse a non-local host via `packages/db/src/local-only.ts` — but do not rely on it. |
| `pnpm test:e2e` | Its `globalSetup` reseeds before running. No host check. |
| `pnpm smoke` twice in 15 min | Spends 4 of the 5-per-email login attempts, and production's limiter is the real one. |

## Verify before and after boot

1. Compare the local public key with the live JWKS. The `x` coordinates must
   match, or the key in `.env` is not production's:

   ```bash
   node -e 'require("dotenv").config();const{createPublicKey}=require("crypto");
   console.log(createPublicKey(process.env.JWT_SIGNING_PUBLIC_PEM.replace(/\\n/g,"\n")).export({format:"jwk"}).x)'
   curl -s https://api.digibimhub.com/.well-known/jwks.json
   ```

2. After the API is up, fetch the live JWKS again. If it changed, the key was
   wrong: fix `.env`, restart the local API, and the next boot writes the
   correct key back.

3. `GET https://api.digibimhub.com/admin/auth/dev-hint` must answer
   `{"enabled":false}`. The local one should too, with `DEV_AUTH_HINT=false`.

## Where the secrets are

Production secrets are Render environment variables on the API service, never
repo files. `.env` is gitignored. An exported copy of the Render environment
was kept on this machine for the paste-in and is meant to be deleted once the
values are in a password manager — a plain-text file with the signing key,
encryption key and database password is the single most valuable thing on the
laptop.

## What an agent session cannot do

The permission classifier blocks ad-hoc SQL against the cloud database from a
session, read-only or not. Verify through the API's own endpoints (`/health`,
the JWKS, `dev-hint`, a real login) rather than by querying the tables.

Related: `dev-vs-prod` for what else differs between the two environments.
