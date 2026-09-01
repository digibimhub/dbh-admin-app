# Add-in authentication

Two requirements that pull against each other, and how they are reconciled.

1. **It must not be forgeable.** A patched DLL is the threat model, not a
   hypothetical.
2. **It must not sign people out.** Losing a session mid-model interrupts work
   in a running application, which is worse than almost any other failure here.

The second one is why some of the obvious hardening is deliberately not done.

## What is trusted

Only what our server got from Autodesk, by exchanging the OAuth code itself.

Nothing the add-in asserts about the machine — Windows domain SID, AD object
GUID, Entra tenant — participates in an access decision. A patched DLL can send
anything, so those signals are worthless for authorisation. `device_hash` and
`machine_name` are recorded for analytics, and the one decision a device carries
is `status = 'disabled'`.

## The sign-in flow

```
add-in                    API                     Autodesk
  │                        │                          │
  ├─ POST /v1/auth/start ─►│  store PKCE verifier     │
  │                        │  + device, single use    │
  │◄── authorize_url ──────┤                          │
  │                        │                          │
  ├─ open browser ─────────┼─────────────────────────►│  user signs in
  │                        │◄── code + state ─────────┤
  │                        │                          │
  │                        ├─ exchangeCode (Basic) ──►│  PKCE verified
  │                        │◄── access token ─────────┤
  │                        ├─ fetchUserInfo ─────────►│
  │                        │◄── sub, email, verified ─┤
  │                        │  resolveUser()           │
  │◄── loopback + handoff ─┤                          │
  │                        │
  ├─ POST /v1/auth/exchange│  handoff redeemed ONCE
  │◄── access + refresh ───┤  re-resolves; an operator may have
  │                        │  changed something in between
```

- The OAuth `state` row is single use and expires in five minutes.
- The handoff is redeemed under `FOR UPDATE`, so two racing add-in instances
  cannot both mint a session from it, and it is stored hashed.
- APS tokens are AES-GCM encrypted before they reach a row: `oauth_states` is a
  scratch table, but a bearer token in plaintext jsonb is a live credential in
  every backup taken while it sat there.
- `email_verified` gates the whole domain tier. An unverified address is a
  string somebody typed.

## Refresh tokens

Stored only as SHA-256 hashes. Rotated on every successful validation, under a
row lock so two Revit instances on one workstation cannot both rotate.

### The replay window — the important part

The obvious hardening is *"a rotated-away token was presented, therefore it was
stolen, therefore revoke."* **Do not do that.** It signs people out constantly:

> The add-in sends a refresh. The API rotates and replies. The reply is lost —
> a dropped VPN, a laptop that slept mid-request. The add-in still holds the old
> token and retries with it. Strict rotation reads that as theft and kills the
> session, so a flaky network becomes a forced sign-in.

Sound rule, common outage. The rule actually implemented branches on **how old**
the stale token is:

| Presented token | Age | Response |
|---|---|---|
| Current hash | — | rotate, return a new pair |
| Previous hash | within **60s** of rotation | rotate normally, say nothing — a retry whose reply was lost |
| Previous hash | older than 60s | **revoke the session** — a token surviving that long elsewhere is theft |
| Unknown hash | — | deny `invalid_token`, leave the session alone |

Whatever was presented becomes the new `previous_token_hash`, so a lost reply to
*this* response is covered by the same window on the next attempt.

A wrong guess never revokes anybody — there is a test asserting that a bogus
token is denied while the real one keeps working.

### Sliding expiry

`expires_at` moves forward on every successful refresh, capped by
`max_lifetime_at`, which is stamped once at issue and never moves. A daily user
is never signed out for having been signed in too long; a stolen token still has
a horizon. The hourly cleanup deletes sessions past that horizon — they can
never be refreshed again, and they hold encrypted APS material.

### A denial is not a revocation

`validate.ts` deliberately does not rotate or revoke when the answer is a deny.
An expired licence is renewed that afternoon. A seat freed at 11:00 should let
the next check through at noon. If a denial burned the refresh token, the
workstation could never come back without a full re-authentication.

`seats_exhausted` depends on exactly this, and so does org suspension.

### Errors are not denials

A 5xx, a timeout or a DNS failure is not an authorisation answer and must never
clear stored credentials. That is what `grace_days` and `offlineGraceExceeded`
are for — and note grace is measured **from the last success**, not from token
expiry, because somebody already offline when their token lapsed would otherwise
get no grace at all.

## Testing it without an Autodesk account

`tests/mock-aps/server.mjs` is a local OIDC issuer, and `pnpm test:e2e` points
the API at it with `APS_AUTH_BASE` / `APS_USERINFO_URL`.

**Nothing inside the API is stubbed.** The exchange still uses Basic client
authentication, the mock verifies the PKCE challenge itself, `email_verified` is
still enforced, and the token is still ES256. Only the issuer's URL differs — the
test double replaces the external service, never the checks, so the code proved
correct by the E2E is the code that runs in production.

Making those URLs configurable is what creates the risk, so the same change adds
the guard:

```ts
// apps/api/src/env.ts — called before the socket opens
assertApsHostsAreAutodesk();
```

In production, any APS endpoint outside `autodesk.com` is a **refusal to boot**,
not a warning. There is no bypass flag and no `dev-login` route: a forgery path
that exists but is "switched off" is one environment variable away from being
switched on.

## Portal sessions

Separate axis. The admin JWT is HS256 with an 8-hour TTL and a step-up TOTP
re-auth on destructive actions. `portal_users.session_epoch` is the deliberate
mass-invalidation lever.

Two operational notes that look like bugs and are not:

- Login is rate limited to **5 per 15 minutes per email**, in memory. Restart
  the API to clear it rather than concluding login is broken.
- An accepted TOTP code is recorded as spent, so the same code cannot be
  replayed inside its 30-second window — including by a different API instance,
  because the counter is on the user row.
