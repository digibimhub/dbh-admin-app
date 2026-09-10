# Add-in integration — endpoints and client rules

How a Revit add-in talks to the licensing API. The reference client that
exercises this exact flow is `tests/mock-addin/server.mjs`; the C# implementation
lives in the `dbh-addins` repo under `Services/Licensing/`.

## Configuration

| | Dev | Production |
| --- | --- | --- |
| API base URL | `http://localhost:3001` | `https://api.digibimhub.com` |
| JWKS | `<base>/.well-known/jwks.json` | same |
| Token issuer (`iss`) | the base URL, exactly | same |

The add-in needs **only the base URL**. APS credentials live on the server;
the add-in never holds them.

In the add-in, the environment is selected by build configuration, never by a
hand edit: Debug → localhost, Release → production, with the `DBH_LICENSE_API`
override compiled out of Release builds (see
`dbh-addins/src/DBH.Addins/Services/Licensing/README.md`).

## Sign-in (once per workstation)

1. Start a loopback HTTP listener on `127.0.0.1:<port>` (1024–65535).
2. `POST /v1/auth/start`
   ```json
   {
     "device": {
       "deviceHash": "<stable machine fingerprint, 16–128 chars>",
       "machineName": "…", "osVersion": "…",
       "revitVersion": "2025", "addinVersion": "1.2.0"
     },
     "redirectPort": 51234
   }
   ```
   → `{ "authorize_url", "state", "expires_in": 300 }`
3. Open `authorize_url` in the **system browser** (never an embedded webview —
   Autodesk sign-in with MFA belongs in the user's own browser).
4. The API completes the Autodesk callback server-side, then redirects the
   browser to `http://127.0.0.1:<port>/callback?result=ok&handoff=<token>`
   (or `result=denied`). Serve a "you can close this tab" page.
5. `POST /v1/auth/exchange` with `{ "handoff": "<token>" }`. The handoff is
   **single-use and lives five minutes** — redeem it immediately.

Success shape (same for exchange and refresh):

```json
{
  "status": "ok",
  "access_token": "…",   // ES256 JWT
  "refresh_token": "…",  // long-lived credential — store encrypted (DPAPI)
  "expires_in": 3600,
  "next_check": "…",     // when to call /v1/token/refresh again
  "session_id": "…",
  "scopes": ["cleanup", "general"],
  "role": "user"
}
```

## Daily validation + heartbeat — one call

`POST /v1/token/refresh` on every Revit launch and thereafter per `next_check`:

```json
{ "refreshToken": "…", "device": { … }, "daysSinceLastSuccess": 0 }
```

Rules that matter:

- **The refresh token rotates on every call.** Persist the new one before
  anything else. A retry with the immediately previous token is tolerated
  (lost-reply window); an old token presented later **revokes the session** as
  theft.
- Scopes and role are **re-resolved on every refresh** — role changes, freed
  seats and renewed licences reach the workstation without re-authentication.
- Report `daysSinceLastSuccess` honestly; the server enforces the licence's
  offline grace window with it.

## Denials — HTTP 200, one code path

Policy denials are never 4xx. Every add-in endpoint answers them as:

```json
{ "status": "denied", "code": "…", "message": "…", "action": "…", "retry_after": 3600 }
```

Show `message` and `action`, disable gated panels, retry after `retry_after`
seconds. **Do not discard the refresh token on a denial** — the session stays
valid server-side precisely so a freed seat (`seats_exhausted`, retry 900s) or a
renewed licence lets the next check succeed without a fresh sign-in.

| Code | Meaning | Fresh sign-in needed? |
| --- | --- | --- |
| `invalid_token` | Session revoked/expired/unknown | **Yes** — the only one |
| `pending_approval` | Waiting for an operator to grant a seat | No |
| `seats_exhausted` | Role's seats are full; one may free up | No |
| `domain_not_registered` | Email domain matches no organisation | No |
| `email_not_verified` | Autodesk account email unverified | No |
| `offline_grace_exceeded` | Too long since a successful check | No — reconnect |
| `device_disabled` | Operator disabled this workstation | No |

## Using the access token

Claims: `iss`, `sub` (org user id), `org`, `org_name`, `email`, `role`,
`scopes`.

- **Gate ribbon panels on `scopes` only.** `role` is informational — support
  reads it in a token; the add-in must never branch on it.
- Panel slugs are append-only and mirror `panel_definitions`:
  `cleanup`, `parameters`, `excel`, `coordination`, `troubleshoot`, `general`.
- `general` is **never gated**: it carries About, Updates and Sign in — a
  licensing failure must not remove its own fix.
- Verify ES256 against the JWKS, selecting the key by the token header's `kid`,
  and check `iss` equals the build's own API base URL.

## Telemetry (optional, batched)

`POST /v1/telemetry` with `Authorization: Bearer <access_token>`:

```json
{ "device": { … }, "activeMinutes": 42, "commands": [ … ], "usageDate": "2026-09-10" }
```

Analytics only — it can never widen access. `activeMinutes` feeds the usage
dashboards; per-command counts are currently accepted and discarded.

## Workstation storage rules

- **Refresh token**: encrypted at rest (Windows DPAPI); it is the long-lived
  credential. The C# client keeps it in `session.dat` behind a per-user mutex,
  because users routinely run three Revit instances at once.
- **Access token**: memory only; re-issued on every refresh.
- **`deviceHash`**: stable, privacy-safe machine fingerprint (e.g. a hash of the
  machine GUID). It keys the device record, per-device rate limits, and the
  stale-device sweep.

## Rate limits

`/v1/*` allows 30 requests per minute per device hash (falling back to IP). The
intended cadence — one refresh per `next_check`, batched telemetry — sits far
under it; a retry loop that hammers on failure will hit it.
