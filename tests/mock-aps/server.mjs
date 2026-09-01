/**
 * A local OIDC issuer, so the add-in sign-in flow can be driven end to end
 * without an Autodesk account.
 *
 * WHAT THIS IS NOT: a way to bypass authentication. The API is not modified,
 * no "dev login" route exists, and no check is skipped. Only the ISSUER URL
 * moves — the API still performs a real authorization-code exchange with Basic
 * client authentication, still reads the profile from a userinfo endpoint, and
 * still applies the `email_verified` gate. The code proved correct by the E2E
 * is the code that runs in production.
 *
 * The safety property that makes that acceptable lives in the API, not here:
 * `assertApsHostsAreAutodesk()` in `apps/api/src/env.ts` refuses to boot when
 * NODE_ENV=production and any APS endpoint points anywhere but autodesk.com.
 *
 *   node tests/mock-aps/server.mjs
 *
 * Environment the API needs to use it:
 *   APS_CLIENT_ID=mock-client
 *   APS_CLIENT_SECRET=mock-secret
 *   APS_AUTH_BASE=http://127.0.0.1:4599/authentication/v2
 *   APS_USERINFO_URL=http://127.0.0.1:4599/userinfo
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_APS_PORT ?? 4599);
const CLIENT_ID = process.env.APS_CLIENT_ID ?? 'mock-client';
const CLIENT_SECRET = process.env.APS_CLIENT_SECRET ?? 'mock-secret';

/** code -> the identity that code will produce, plus the PKCE challenge. */
const codes = new Map();
/** access token -> identity, for /userinfo. */
const tokens = new Map();

/**
 * Who the next /authorize call signs in as.
 *
 * The test drives this over HTTP rather than through a query parameter,
 * because the add-in — not the test — is what opens the authorize URL.
 */
let nextIdentity = {
  sub: 'ADSK_MOCK_1',
  email: 'mock@example.test',
  email_verified: true,
  name: 'Mock Person',
  given_name: 'Mock',
  family_name: 'Person',
};

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  /* ---- test control -------------------------------------------------- */

  // Who the NEXT sign-in is. Not part of the OIDC surface; the E2E calls it.
  if (url.pathname === '/__identity' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}');
    nextIdentity = { ...nextIdentity, ...body };
    return json(res, 200, { ok: true, identity: nextIdentity });
  }

  if (url.pathname === '/__health') return json(res, 200, { ok: true });

  /* ---- OIDC ---------------------------------------------------------- */

  /**
   * The consent screen, minus the screen. A real user would land on Autodesk
   * and sign in; the mock issues the code immediately and redirects back, so
   * the browser never has to interact with a third party.
   */
  if (url.pathname === '/authentication/v2/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    const challenge = url.searchParams.get('code_challenge');

    if (url.searchParams.get('client_id') !== CLIENT_ID) {
      return json(res, 400, { error: 'invalid_client' });
    }
    if (!redirectUri || !state || !challenge) {
      return json(res, 400, { error: 'invalid_request' });
    }

    const code = randomUUID();
    codes.set(code, { identity: { ...nextIdentity }, challenge, redirectUri });

    const back = new URL(redirectUri);
    back.searchParams.set('code', code);
    back.searchParams.set('state', state);
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }

  if (url.pathname === '/authentication/v2/token' && req.method === 'POST') {
    // Basic client authentication, exactly as the real exchange sends it.
    const auth = req.headers.authorization ?? '';
    const expected = `Basic ${Buffer.from(
      `${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`,
      'utf8',
    ).toString('base64')}`;
    if (auth !== expected) return json(res, 401, { error: 'invalid_client' });

    const form = new URLSearchParams(await readBody(req));
    const grant = form.get('grant_type');

    if (grant === 'refresh_token') {
      const token = randomUUID();
      tokens.set(token, { ...nextIdentity });
      return json(res, 200, { access_token: token, refresh_token: randomUUID(), expires_in: 3600 });
    }

    const code = form.get('code');
    const entry = code ? codes.get(code) : undefined;
    if (!entry) return json(res, 400, { error: 'invalid_grant' });
    codes.delete(code); // single use, like the real thing

    /**
     * A REAL PKCE check. The API sends the verifier it stored at /start; the
     * challenge came from the authorize call. If this were waved through, the
     * E2E would pass with a broken PKCE implementation, which is exactly the
     * kind of hole a test double is supposed not to open.
     */
    const verifier = form.get('code_verifier') ?? '';
    const computed = b64url(createHash('sha256').update(verifier).digest());
    if (computed !== entry.challenge) return json(res, 400, { error: 'invalid_grant', reason: 'pkce' });

    if (form.get('redirect_uri') !== entry.redirectUri) {
      return json(res, 400, { error: 'invalid_grant', reason: 'redirect_uri' });
    }

    const token = randomUUID();
    tokens.set(token, entry.identity);
    return json(res, 200, {
      access_token: token,
      refresh_token: randomUUID(),
      expires_in: 3600,
      scope: form.get('scope') ?? 'openid email user-profile:read',
    });
  }

  if (url.pathname === '/userinfo') {
    const auth = req.headers.authorization ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const identity = tokens.get(token);
    if (!identity) return json(res, 401, { error: 'invalid_token' });
    return json(res, 200, identity);
  }

  json(res, 404, { error: 'not_found', path: url.pathname });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock APS issuer on http://127.0.0.1:${PORT}`);
});
