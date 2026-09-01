import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  getApsConfig, apsConfigured, authorizeUrl,
  pkceVerifier, pkceChallenge,
  exchangeCode, refreshApsToken, fetchUserInfo, fetchAccAccountIds,
  accountIdsFromHubs,
  type ApsConfig,
} from './aps.ts';

const CFG: ApsConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  callbackUrl: 'https://api.yourco.com/v1/auth/callback',
  scopes: 'openid email user-profile:read data:read',
};

/* ------------------------------------------------------------------ *
 * fetch stub — no test in this file touches the network.
 * ------------------------------------------------------------------ */

interface Captured { url: string; init: RequestInit }
let calls: Captured[] = [];
let realFetch: typeof globalThis.fetch;

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

beforeEach(() => { calls = []; realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const header = (n: number, name: string): string | undefined => {
  const h = calls[n]?.init.headers as Record<string, string> | undefined;
  return h?.[name];
};
const body = (n: number): URLSearchParams =>
  new URLSearchParams(String(calls[n]?.init.body ?? ''));

/* ---------------- configuration ---------------- */

describe('configuration', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.APS_CLIENT_ID = saved.APS_CLIENT_ID;
    process.env.APS_CLIENT_SECRET = saved.APS_CLIENT_SECRET;
    process.env.APS_SCOPES = saved.APS_SCOPES;
  });

  test('apsConfigured is false until both credentials are present', () => {
    delete process.env.APS_CLIENT_ID;
    delete process.env.APS_CLIENT_SECRET;
    assert.equal(apsConfigured(), false);
    process.env.APS_CLIENT_ID = 'id';
    assert.equal(apsConfigured(), false);
    process.env.APS_CLIENT_SECRET = 'secret';
    assert.equal(apsConfigured(), true);
  });

  test('getApsConfig throws rather than starting a flow with no credentials', () => {
    delete process.env.APS_CLIENT_ID;
    delete process.env.APS_CLIENT_SECRET;
    assert.throws(() => getApsConfig(), /not configured/);
  });

  test('default scopes include data:read, which the ACC tier needs', () => {
    // Without data:read the hubs call is forbidden, resolveUser never sees an
    // ACC account id, and every user falls through to email-domain matching.
    process.env.APS_CLIENT_ID = 'id';
    process.env.APS_CLIENT_SECRET = 'secret';
    delete process.env.APS_SCOPES;
    const cfg = getApsConfig();
    assert.ok(cfg.scopes.includes('openid'));
    assert.ok(cfg.scopes.includes('data:read'));
  });
});

/* ---------------- PKCE ---------------- */

describe('PKCE', () => {
  test('challenge matches the RFC 7636 appendix B test vector', () => {
    // Autodesk recomputes exactly this at the token endpoint. Hex or padded
    // base64 fails every authorization, at the end of the browser round trip.
    assert.equal(
      pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  test('challenge is unpadded base64url of the SHA-256 digest, never hex', () => {
    const v = pkceVerifier();
    const c = pkceChallenge(v);
    assert.equal(c, createHash('sha256').update(v).digest('base64url'));
    assert.equal(c.length, 43);
    assert.ok(!c.includes('='));
    assert.ok(!/^[0-9a-f]{64}$/.test(c), 'a hex digest would be rejected by APS');
  });

  test('verifier is in the RFC 7636 43-128 unreserved-character range', () => {
    const v = pkceVerifier();
    assert.match(v, /^[A-Za-z0-9._~-]{43,128}$/);
    assert.notEqual(v, pkceVerifier());
  });
});

/* ---------------- authorize URL ---------------- */

describe('authorizeUrl', () => {
  test('targets the v2 authorize endpoint with every required parameter', () => {
    const u = new URL(authorizeUrl(CFG, 'state-123', 'challenge-abc'));
    assert.equal(u.origin + u.pathname, 'https://developer.api.autodesk.com/authentication/v2/authorize');
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('client_id'), CFG.clientId);
    assert.equal(u.searchParams.get('redirect_uri'), CFG.callbackUrl);
    assert.equal(u.searchParams.get('scope'), CFG.scopes);
    assert.equal(u.searchParams.get('state'), 'state-123');
    assert.equal(u.searchParams.get('code_challenge'), 'challenge-abc');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  });

  test('never puts the client secret in a URL the user sees', () => {
    assert.ok(!authorizeUrl(CFG, 's', 'c').includes(CFG.clientSecret));
  });
});

/* ---------------- token endpoint ---------------- */

describe('token exchange', () => {
  test('posts form-encoded to the v2 token endpoint', async () => {
    stubFetch(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid' });
    const t = await exchangeCode(CFG, 'auth-code', 'the-verifier');

    assert.equal(calls[0]?.url, 'https://developer.api.autodesk.com/authentication/v2/token');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.equal(header(0, 'content-type'), 'application/x-www-form-urlencoded');
    assert.equal(t.accessToken, 'at');
    assert.equal(t.refreshToken, 'rt');
    assert.equal(t.expiresIn, 3600);
  });

  test('authenticates with HTTP Basic, as APS requires of a confidential app', async () => {
    stubFetch(200, { access_token: 'at', expires_in: 3600 });
    await exchangeCode(CFG, 'auth-code', 'the-verifier');

    const auth = header(0, 'authorization');
    assert.ok(auth?.startsWith('Basic '));
    assert.equal(
      Buffer.from(auth!.slice(6), 'base64').toString(),
      `${CFG.clientId}:${CFG.clientSecret}`,
    );
  });

  test('does not also send credentials in the body — RFC 6749 forbids two methods', async () => {
    stubFetch(200, { access_token: 'at', expires_in: 3600 });
    await exchangeCode(CFG, 'auth-code', 'the-verifier');

    const form = body(0);
    assert.equal(form.get('client_secret'), null);
    assert.equal(form.get('client_id'), null);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('code'), 'auth-code');
    assert.equal(form.get('code_verifier'), 'the-verifier');
    assert.equal(form.get('redirect_uri'), CFG.callbackUrl);
  });

  test('redirect_uri must match the authorize call byte for byte', async () => {
    stubFetch(200, { access_token: 'at', expires_in: 3600 });
    const authorized = new URL(authorizeUrl(CFG, 's', 'c')).searchParams.get('redirect_uri');
    await exchangeCode(CFG, 'code', 'v');
    assert.equal(body(0).get('redirect_uri'), authorized);
  });

  test('a failure reports the status only, never the grant code', async () => {
    stubFetch(400, { error: 'invalid_grant', error_description: 'code auth-code-secret is invalid' });
    await assert.rejects(
      () => exchangeCode(CFG, 'auth-code-secret', 'v'),
      (e: Error) => {
        assert.match(e.message, /token exchange failed \(400\)/);
        assert.ok(!e.message.includes('auth-code-secret'));
        assert.ok(!e.message.includes(CFG.clientSecret));
        return true;
      },
    );
  });

  test('refreshApsToken uses the refresh_token grant', async () => {
    stubFetch(200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 });
    const t = await refreshApsToken(CFG, 'stored-refresh-token');

    const form = body(0);
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'stored-refresh-token');
    assert.ok(header(0, 'authorization')?.startsWith('Basic '));
    assert.equal(t.accessToken, 'at2');
    assert.equal(t.refreshToken, 'rt2');
  });

  test('a refresh failure does not echo the refresh token', async () => {
    stubFetch(401, { error: 'invalid_grant' });
    await assert.rejects(
      () => refreshApsToken(CFG, 'super-secret-refresh'),
      (e: Error) => !e.message.includes('super-secret-refresh') && /401/.test(e.message),
    );
  });
});

/* ---------------- userinfo ---------------- */

describe('userinfo', () => {
  test('calls the OIDC userinfo host with a bearer token', async () => {
    stubFetch(200, { sub: 'ABC123', email: 'j.smith@alec.in', email_verified: true, name: 'J Smith' });
    const info = await fetchUserInfo('access-token');

    assert.equal(calls[0]?.url, 'https://api.userprofile.autodesk.com/userinfo');
    assert.equal(header(0, 'authorization'), 'Bearer access-token');
    assert.equal(info.sub, 'ABC123');
    assert.equal(info.email, 'j.smith@alec.in');
    assert.equal(info.emailVerified, true);
    assert.equal(info.name, 'J Smith');
  });

  test('maps the snake_case OIDC names onto the identity shape', async () => {
    stubFetch(200, {
      sub: 'ABC123', email: 'a@b.com', email_verified: true,
      given_name: 'Jane', family_name: 'Smith',
    });
    const info = await fetchUserInfo('t');
    assert.equal(info.givenName, 'Jane');
    assert.equal(info.familyName, 'Smith');
  });

  test('the STRING "false" is not verified — Boolean("false") is true', async () => {
    // email_verified gates the whole email-domain tier of resolveUser. A truthy
    // coercion here would auto-provision anyone into a customer's org on the
    // strength of an unverified address they typed themselves.
    stubFetch(200, { sub: 'ABC123', email: 'attacker@alec.in', email_verified: 'false' });
    assert.equal((await fetchUserInfo('t')).emailVerified, false);
  });

  test('the STRING "true" is verified', async () => {
    stubFetch(200, { sub: 'ABC123', email: 'a@b.com', email_verified: 'true' });
    assert.equal((await fetchUserInfo('t')).emailVerified, true);
  });

  test('a missing or non-boolean email_verified is not verified', async () => {
    for (const v of [undefined, null, 0, 1, 'yes', {}]) {
      stubFetch(200, { sub: 'ABC123', email: 'a@b.com', email_verified: v });
      assert.equal((await fetchUserInfo('t')).emailVerified, false, `value ${JSON.stringify(v)}`);
    }
  });

  test('email is lowercased so domain matching is stable', async () => {
    stubFetch(200, { sub: 'ABC123', email: 'J.Smith@ALEC.IN', email_verified: true });
    assert.equal((await fetchUserInfo('t')).email, 'j.smith@alec.in');
  });

  test('a missing email becomes an empty string, not undefined', async () => {
    stubFetch(200, { sub: 'ABC123' });
    assert.equal((await fetchUserInfo('t')).email, '');
  });

  test('a non-200 throws with the status', async () => {
    stubFetch(401, { error: 'unauthorized' });
    await assert.rejects(() => fetchUserInfo('t'), /userinfo failed \(401\)/);
  });
});

/* ---------------- hubs / ACC accounts ---------------- */

describe('accountIdsFromHubs', () => {
  const hub = (id: string, name: string) => ({
    type: 'hubs', id, attributes: { name, extension: { type: 'hubs:autodesk.bim360:Account' } },
  });

  test('strips the b. prefix that Data Management puts on account hubs', () => {
    const ids = accountIdsFromHubs({
      data: [hub('b.9a8b7c6d-1111-2222-3333-444455556666', 'Alec Engineering')],
    });
    assert.deepEqual(ids, ['9a8b7c6d-1111-2222-3333-444455556666']);
  });

  test('drops personal a. hubs, which are not ACC accounts', () => {
    // An a. hub is one person's own A360 space. Treating it as an account id
    // would let a personal hub match an org_domains row.
    const ids = accountIdsFromHubs({
      data: [hub('a.personal-hub', 'My Hub'), hub('b.real-account', 'Acme')],
    });
    assert.deepEqual(ids, ['real-account']);
  });

  test('deduplicates repeated accounts', () => {
    const ids = accountIdsFromHubs({ data: [hub('b.acct', 'A'), hub('b.acct', 'A again')] });
    assert.deepEqual(ids, ['acct']);
  });

  test('returns [] for every malformed shape instead of throwing', () => {
    // This runs on a response from a third party during sign-in; a throw here
    // is an outage, not a denial.
    for (const p of [null, undefined, {}, { data: null }, { data: 'x' }, { data: [{}] },
      { data: [{ id: 42 }] }, { data: [{ id: 'b.' }] }, { data: [{ id: 'nohubprefix' }] }]) {
      assert.deepEqual(accountIdsFromHubs(p), [], JSON.stringify(p));
    }
  });
});

describe('fetchAccAccountIds', () => {
  test('calls the Data Management hubs endpoint', async () => {
    stubFetch(200, { data: [{ id: 'b.acct-1' }, { id: 'b.acct-2' }] });
    const ids = await fetchAccAccountIds('access-token');
    assert.equal(calls[0]?.url, 'https://developer.api.autodesk.com/project/v1/hubs');
    assert.equal(header(0, 'authorization'), 'Bearer access-token');
    assert.deepEqual(ids, ['acct-1', 'acct-2']);
  });

  test('a missing data:read scope degrades to the next tier, it does not deny', async () => {
    // The ACC tier is an optimisation over email-domain matching. A 403 must
    // not lock out a user whose domain is perfectly well registered.
    stubFetch(403, { developerMessage: 'insufficient scope' });
    assert.deepEqual(await fetchAccAccountIds('t'), []);
    stubFetch(401, { developerMessage: 'expired' });
    assert.deepEqual(await fetchAccAccountIds('t'), []);
  });

  test('an unexpected server error still throws', async () => {
    stubFetch(500, { error: 'boom' });
    await assert.rejects(() => fetchAccAccountIds('t'), /hubs failed \(500\)/);
  });
});
