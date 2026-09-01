# Autodesk Platform Services — setup for local validation

Nothing in the Autodesk sign-in path can be exercised until an APS app exists.
`APS_CLIENT_ID` and `APS_CLIENT_SECRET` are blank in `.env`, and
`apsConfigured()` returns false, so `/v1/auth/start` refuses before it reaches
Autodesk. This is the one step that cannot be done from the repo.

## 1. Register the app

At <https://aps.autodesk.com/myapps>, **Create application**.

| Field | Value | Why |
|---|---|---|
| Application type | **Web App** | It must be a *confidential* client. The secret lives on our server, never in a shipped DLL — that is the whole reason the add-in talks to us instead of to Autodesk directly. |
| Callback URL | `http://localhost:3001/v1/auth/callback` | Must match `APS_CALLBACK_URL` byte for byte. Autodesk compares it as an exact string; a trailing slash is a different URL. |
| APIs | Data Management API, plus the default authentication | `data:read` is what makes the ACC-account tier of `resolveUser()` reachable. |

Note the **Client ID** and **Client Secret**. The secret is shown once.

## 2. Put them in `.env`

```
APS_CLIENT_ID=<client id>
APS_CLIENT_SECRET=<client secret>
APS_CALLBACK_URL=http://localhost:3001/v1/auth/callback
APS_SCOPES=openid email user-profile:read data:read
```

`.env` is gitignored. In production these become Fly secrets, never repo files.

## 3. APS scopes are NOT the standard OIDC scope names

Do not write `openid profile email`. **`profile` is not an APS scope**, and
including it fails the authorization with:

```json
{"error":"invalid_scope","error_description":"The requested scope is invalid, unknown, malformed, …"}
```

Verified against a live app registration: every combination *without* `profile`
is accepted; `openid profile` on its own is rejected. The APS equivalents are
`email` for the address and **`user-profile:read`** for name / given_name /
family_name, which is what `fetchUserInfo()` reads.

| Want | Standard OIDC | APS |
|---|---|---|
| Subject / sign-in | `openid` | `openid` ✓ same |
| Email address | `email` | `email` ✓ same |
| Name fields | `profile` | **`user-profile:read`** |
| ACC hubs | — | `data:read` |

The failure is easy to misread, because the authorization endpoint accepts the
request and only Autodesk's identity provider rejects it one redirect later —
so it surfaces as a bare JSON error in the browser after the redirect, not as a
response to any call you made.

## 4. Why `data:read` matters more than it looks

Drop it and everything still appears to work — sign-in succeeds, users resolve,
tokens issue. What silently stops working is the middle tier of resolution.

Without `data:read`, `/project/v1/hubs` returns 403, so `accAccountIds` is
always empty and every first-time user falls through to email-domain matching.
For a domain listed by exactly one org that is invisible. For `alec.in`, which
the seed deliberately lists under **two** orgs, it is the difference between
resolving the user and denying them with `multiple_orgs` and a queue entry.

So: if access requests start piling up with `multiple_orgs` after a scope
change, this is the first thing to check.

## 5. The redirect chain, and the part that surprises people

```
add-in ──> POST /v1/auth/start          we store PKCE verifier + state
        <── authorize_url
add-in ──> opens the SYSTEM BROWSER at authorize_url
user   ──> signs in to Autodesk
Autodesk ─> GET /v1/auth/callback?code=&state=      (our server)
        our server exchanges code -> APS tokens, calls userinfo,
        runs resolveUser(), then redirects to:
        http://127.0.0.1:<port>/callback?result=ok&handoff=...
add-in ──> POST /v1/auth/exchange       swaps handoff for our own tokens
```

Two things to know before debugging this:

- **The browser is the system browser, not an embedded WebView.** Autodesk
  blocks embedded browsers for OAuth, and SSO/MFA frequently will not complete
  in one. The add-in listens on a loopback port and Autodesk never sees it —
  only our callback redirects there.
- **The code exchange happens on our server, not in the add-in.** That is why
  identity is trustworthy: `autodesk_id` and `email_verified` come back from
  Autodesk to us over a channel a patched DLL cannot reach. Anything the add-in
  asserts about the machine is analytics.

## 6. Validating without a Revit add-in

The add-in does not exist yet, but the whole server side is exercisable with a
browser and curl, because the loopback redirect at the end is the only part
that needs a listener:

```bash
# 1. start the flow (any free port; nothing has to be listening yet)
curl -s -X POST http://localhost:3001/v1/auth/start \
  -H 'content-type: application/json' \
  -d '{"device":{"deviceHash":"sha256:manual-test-0000000000000000"},"redirectPort":51234}'

# 2. open the returned authorize_url in a browser, sign in

# 3. the browser lands on 127.0.0.1:51234 and fails to connect — that is
#    expected. Read `handoff` out of the address bar and exchange it:
curl -s -X POST http://localhost:3001/v1/auth/exchange \
  -H 'content-type: application/json' -d '{"handoff":"<from the URL>"}'
```

A successful exchange returns an ES256 access token. Paste it into
<https://jwt.io> and confirm the `panels` array matches what the portal shows
for that user — that round trip is the actual thing being validated, and it is
the same contract the add-in will consume.

If the account you sign in with has an email domain no org lists, the correct
result is a **denial with `domain_not_registered` and a new row in
Access Requests** — not an error. Approve it in the portal, retry, and it
resolves. That is the flow working, not failing.
