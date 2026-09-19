---
name: revit-account-match
description: The browser-vs-Revit identity contract between the add-in and the API — revitLoginUserId on /v1/auth/start and /v1/token/refresh, the autodesk_id token claim, the revit_account_mismatch denial, where each comparison happens and is logged, the facts already established about Autodesk's ids, and the four things not to undo. Load before touching /v1/auth, /v1/token/refresh, resolve.ts deny codes, or the add-in's AccountMatch.
---

# One licence, one Autodesk account: the browser must be Revit's user

A user whose browser is signed in to one Autodesk account and whose Revit is
signed in to another used to get a licence resolved against whoever the
browser knew. The rule now is that the two must be the same person. Multiple
devices per person are fine — seats are per person, and Revit's own licensing
limits concurrent use.

## The contract

| Piece | Where |
| --- | --- |
| `revitLoginUserId` — optional on `/v1/auth/start` and `/v1/token/refresh` | `authStartSchema`, `tokenRefreshSchema` in `packages/shared/src/index.ts` |
| `mismatchedRevitAccount(claimed, autodeskId)` — the single comparison | `packages/core/src/resolve.ts`, tests in `revit-account.test.ts` |
| Callback: compared against userinfo `sub` **before `resolveUser`** | `apps/api/src/routes/addin/auth.ts` |
| Exchange: compared **again**, not read from the stored `denied` | same |
| Refresh: compared against `org_users.autodesk_id` before the re-resolve | `apps/api/src/routes/addin/validate.ts` |
| Deny code `revit_account_mismatch` | `DenyCode` in `resolve.ts`, `denyCode` in shared, wording in `packages/core/src/deny-messages.ts` |
| Token claim `autodesk_id` | `signAccessToken` in `apps/api/src/lib/addin-grant.ts`, `addinTokenClaims` in shared |
| One `[addin:revit-account]` log line per comparison | `apps/api/src/lib/revit-account-log.ts` — identifiers only, never a token |

The add-in sends `Application.LoginUserId` on `/start`, omitted when blank. It
reads `autodesk_id` from the token and logs an `Identity probe` line with both
ids on every successful sign-in, and a `Sign-in denied` line with the Revit
account on every refusal. Its own handle-vs-email heuristic in
`Services/Licensing/AccountMatch.cs` (dbh-addins) still runs after a grant.

## Four things not to undo

1. **The callback check runs before `resolveUser`.** That function is not a
   read: it creates the membership that makes somebody a pending member of an
   organisation. Resolving first would enrol the browser's account into an org
   nobody asked it to join, and a mismatch would cost a seat.
2. **The exchange re-checks; it does not read `payload.denied`.** The exchange
   deliberately re-resolves everything an operator could have changed since
   the callback. A mismatch is not one of those things — nobody can approve it
   away — so without the second check the exchange grants what the callback
   refused.
3. **The callback rebuilds `StatePayload` rather than spreading it**, so
   `revitLoginUserId` is carried forward by an explicit line. Deleting that
   line silently disables the exchange check. This was a live bug once.
4. **Absent means "cannot check", never "refuse".** An older add-in must still
   sign in, Revit can be signed out (the add-in refuses that itself), and a
   member imported by an operator has no `autodesk_id` to compare at refresh.
   A value that does arrive is always compared.

## Facts already established — do not re-derive

- **`LoginUserId` is the same string as userinfo `sub` / the token's
  `autodesk_id`.** Observed on a real sign-in on 2026-09-19:
  `PSZ29R7JMHXV8VKE` on both sides. Before that nobody had seen a pair, and the
  whole comparison rested on it. The add-in's handle-vs-email heuristic is
  therefore redundant and its false-refusal risk (a renamed handle) no longer
  buys anything — replace it with an exact compare, or drop it in favour of
  the server check.
- **The token's `sub` is `org_users.id`**, not an Autodesk id. Comparing it to
  `LoginUserId` never matches. That is why `autodesk_id` is a separate claim.
- **Revit's `Application.Username` is the Autodesk handle** (`vijay006rv`,
  `infoC8V4K`), not an email. `IsLoggedIn` is static on the Revit application
  type; `Username` and `LoginUserId` are instance members.
- **Seats are per person and role**, counted as
  `count(*) FROM org_users WHERE org_id = ? AND role_key = ? AND status = 'active'`.
  `devices` is analytics only.

## Why this does not breach the identity invariant

`AGENTS.md` forbids machine-asserted signals in access decisions.
`revitLoginUserId` is client-asserted but cannot grant, widen or name anybody;
identity still comes only from the code exchange. All it can do is cause a
refusal, so a forged value refuses its own sign-in and nothing more. Keep it
that way: the moment it can grant anything it becomes what the rule prohibits.

## Known gaps

- The add-in's **startup refresh sends no id** yet. `OnStartup` only has
  `UIControlledApplication`, which does not expose `LoginUserId`; reading it
  means moving the check onto `ControlledApplication.ApplicationInitialized`.
  Until then the refresh-time comparison only fires for callers that pass it.
- The add-in **does not verify the token signature** (its own code calls this
  phase 1), and `DBH_LICENSE_API` is honoured in every build. Scopes are read
  from an unverified JWT.
- Add-in **sign-out does not revoke the server session**; the refresh token
  stays valid for the idle window (30 days) or the hard horizon (90).

## Where to read what happened

- Add-in: `%APPDATA%\DBH\DBH.Addins\logs\DBH.Addins-YYYYMMDD.log`, source
  `Licensing`. `Identity probe:` on a grant, `Sign-in denied: code=…` on a
  refusal, `/v1/auth/exchange denied: <code>` from the HTTP layer.
- API stdout: `[addin:revit-account] callback|exchange|refresh: revit_login_user_id=… autodesk_id=… email=… -> match | MISMATCH — refused | unchecked`.

See `docs/addin-auth.md` ("The browser and Revit must be the same person") and
`docs/ADDIN-INTEGRATION.md` for the client-facing contract.
