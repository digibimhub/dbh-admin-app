/**
 * Autodesk Platform Services client — Authentication API v2.
 *
 * Wired in a later phase once APS_CLIENT_ID / APS_CLIENT_SECRET are set.
 * The add-in never holds the client secret, so this app is a CONFIDENTIAL
 * client: APS expects its credentials in an HTTP Basic header, not in the
 * form body.
 *
 * Every call here sits in a request path, so each one is bounded by a
 * timeout. An APS outage that hangs the socket must not hold a Revit user's
 * sign-in open until the reverse proxy gives up.
 */
import { randomToken, sha256Base64Url } from './crypto.ts';

/**
 * Autodesk endpoints, overridable ONLY so the test suite can point them at a
 * local OIDC issuer.
 *
 * Nothing about the verification changes when they are overridden: the code
 * exchange, the PKCE check and the `email_verified` gate all still run,
 * against whatever issuer is configured. That is the whole point — the test
 * double replaces the external service, never the checks, so the code proved
 * correct by the E2E is the code that runs in production.
 *
 * Making these configurable is what creates the risk, so the same change adds
 * `assertApsHostsAreAutodesk()`, called from the API's env.ts, which refuses
 * to boot in production if any of them points somewhere else.
 */
const AUTH_BASE = process.env.APS_AUTH_BASE
  ?? 'https://developer.api.autodesk.com/authentication/v2';
/** OIDC userinfo endpoint from Autodesk's discovery document — a different host to the API base. */
const USERINFO_URL = process.env.APS_USERINFO_URL
  ?? 'https://api.userprofile.autodesk.com/userinfo';
/** Data Management API. Needs the `data:read` scope. */
const HUBS_URL = 'https://developer.api.autodesk.com/project/v1/hubs';

/** Every overridable Autodesk endpoint, for the production boot guard. */
export function apsEndpoints(): { name: string; url: string }[] {
  return [
    { name: 'APS_AUTH_BASE', url: AUTH_BASE },
    { name: 'APS_USERINFO_URL', url: USERINFO_URL },
  ];
}

/**
 * True when every APS endpoint still points at Autodesk.
 *
 * Deliberately a suffix match on the registrable domain rather than a regex
 * over the whole URL: `https://autodesk.com.evil.test` must not pass, and
 * `endsWith('.autodesk.com')` on the hostname is the check that gets that
 * right.
 */
export function apsHostsAreAutodesk(): { ok: boolean; offenders: string[] } {
  const offenders = apsEndpoints()
    .filter(({ url }) => {
      try {
        const host = new URL(url).hostname.toLowerCase();
        return !(host === 'autodesk.com' || host.endsWith('.autodesk.com'));
      } catch {
        return true;
      }
    })
    .map(({ name, url }) => `${name}=${url}`);
  return { ok: offenders.length === 0, offenders };
}

const TIMEOUT_MS = 10_000;

export interface ApsConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes: string;
}

export interface ApsUserInfo {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
}

export interface ApsTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

export function apsConfigured(): boolean {
  return Boolean(process.env.APS_CLIENT_ID && process.env.APS_CLIENT_SECRET);
}

export function getApsConfig(): ApsConfig {
  const clientId = process.env.APS_CLIENT_ID ?? '';
  const clientSecret = process.env.APS_CLIENT_SECRET ?? '';
  const callbackUrl = process.env.APS_CALLBACK_URL ?? 'http://localhost:3001/v1/auth/callback';
  // `data:read` is what makes the ACC-account tier of resolveUser reachable:
  // without it /project/v1/hubs is forbidden and every user falls through to
  // email-domain matching. Matches .env.example.
  const scopes = process.env.APS_SCOPES ?? 'openid email user-profile:read data:read';
  if (!clientId || !clientSecret) throw new Error('APS credentials are not configured');
  return { clientId, clientSecret, callbackUrl, scopes };
}

/* ------------------------------- PKCE -------------------------------- */

/**
 * RFC 7636 code_verifier: 43 characters of base64url from 32 random bytes,
 * inside the required 43-128 unreserved-character range.
 */
export function pkceVerifier(): string {
  return randomToken(32);
}

/**
 * RFC 7636 S256 challenge: BASE64URL(SHA256(ASCII(verifier))), unpadded.
 *
 * Hex is NOT interchangeable here. Autodesk recomputes this exact encoding at
 * the token endpoint and rejects the exchange when it differs, so a hex digest
 * fails every authorization — and it fails at the very end of the browser
 * round trip, where it looks like an Autodesk problem rather than ours.
 */
export function pkceChallenge(verifier: string): string {
  return sha256Base64Url(verifier);
}

/* --------------------------- authorization --------------------------- */

export function authorizeUrl(cfg: ApsConfig, state: string, codeChallenge: string): string {
  const u = new URL(`${AUTH_BASE}/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.callbackUrl);
  u.searchParams.set('scope', cfg.scopes);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

/* ------------------------------ transport ---------------------------- */

/**
 * RFC 6749 requires the Basic credentials to be percent-encoded before
 * base64. APS ids and secrets are alphanumeric today, but encoding costs
 * nothing and removes a class of failure that would only appear the day
 * Autodesk widens its secret alphabet.
 */
function basicAuth(cfg: ApsConfig): string {
  const raw = `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

function apsFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/**
 * APS error bodies echo request parameters. Surface only the status, so a
 * grant code or a refresh token can never reach a log line or a client.
 */
async function tokenRequest(cfg: ApsConfig, body: URLSearchParams, what: string): Promise<ApsTokens> {
  const res = await apsFetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      authorization: basicAuth(cfg),
    },
    body,
  });
  if (!res.ok) throw new Error(`APS ${what} failed (${res.status})`);
  const json = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
  };
}

export async function exchangeCode(cfg: ApsConfig, code: string, codeVerifier: string): Promise<ApsTokens> {
  // No client_id / client_secret in the body: RFC 6749 forbids combining two
  // client authentication methods, and Basic is the documented one for a
  // confidential APS app.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.callbackUrl,
    code_verifier: codeVerifier,
  });
  return tokenRequest(cfg, body, 'token exchange');
}

/**
 * APS access tokens last an hour. The hourly `sync-acc` job needs this to keep
 * hub data fresh without dragging the user back through a browser.
 */
export async function refreshApsToken(cfg: ApsConfig, refreshToken: string): Promise<ApsTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: cfg.scopes,
  });
  return tokenRequest(cfg, body, 'token refresh');
}

/* ------------------------------ userinfo ----------------------------- */

/**
 * OIDC permits `email_verified` as a boolean or as the STRING "true"/"false",
 * and `Boolean("false")` is `true`. This claim gates the entire email-domain
 * tier of resolveUser, so coerce it explicitly rather than truthily.
 */
function isVerified(value: unknown): boolean {
  return value === true || value === 'true';
}

export async function fetchUserInfo(accessToken: string): Promise<ApsUserInfo> {
  const res = await apsFetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`APS userinfo failed (${res.status})`);
  const json = await res.json() as {
    sub: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    given_name?: string;
    family_name?: string;
  };
  return {
    sub: json.sub,
    // Domain matching lowercases anyway; normalising here keeps the stored
    // org_users.email consistent with what emailDomain() compares against.
    email: (json.email ?? '').toLowerCase(),
    emailVerified: isVerified(json.email_verified),
    name: json.name,
    givenName: json.given_name,
    familyName: json.family_name,
  };
}

/* -------------------------------- hubs ------------------------------- */

/**
 * Data Management returns hubs as JSON:API. Account-backed hubs (ACC and
 * BIM 360) carry a `b.`-prefixed id whose remainder is the ACC account id;
 * personal A360 hubs use `a.` and are not accounts, so they are dropped.
 *
 * Kept separate from the fetch so the parsing — the part that decides which
 * organisation a person lands in — is unit-testable without a network call.
 */
export function accountIdsFromHubs(payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const ids = new Set<string>();
  for (const entry of data) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id.startsWith('b.') && id.length > 2) {
      ids.add(id.slice(2));
    }
  }
  return [...ids];
}

/**
 * ACC account ids for the signed-in user.
 *
 * Returns [] rather than throwing when the token lacks `data:read` (403) —
 * the ACC tier is an optimisation over email-domain matching, so a missing
 * scope must degrade to the next tier, never deny a legitimate sign-in.
 */
export async function fetchAccAccountIds(accessToken: string): Promise<string[]> {
  const res = await apsFetch(HUBS_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) return [];
  if (!res.ok) throw new Error(`APS hubs failed (${res.status})`);
  return accountIdsFromHubs(await res.json());
}
