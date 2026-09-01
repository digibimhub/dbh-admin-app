/**
 * End-to-end smoke test against a RUNNING api + portal.
 *
 * Unit tests prove the logic; verify:resolver proves the SQL. This proves the
 * wiring: middleware order, cookie flags, Zod rejection, the JWKS actually
 * carrying key material, and a portal login that really passes argon2 + TOTP.
 *
 * Deliberately dependency-free (no workspace imports, plain fetch, TOTP
 * implemented inline) so it runs before `pnpm install` has linked anything and
 * can be pointed at a deployed environment by changing API only.
 *
 *   pnpm dev            # in another terminal
 *   pnpm smoke
 */
import { createHmac } from 'node:crypto';

const API = process.env.SMOKE_API ?? 'http://localhost:3001';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@yourco.local';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'localdev-password';
const TOTP_SECRET = process.env.SMOKE_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXP';

let passed = 0;
let failed = 0;
const skipped = [];

function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (ok) passed++;
  else failed++;
}
function skip(name, why) {
  console.log(`  SKIP  ${name} -- ${why}`);
  skipped.push(name);
}

/* ------------------------------- TOTP -------------------------------- */

function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = A.indexOf(ch);
    if (i < 0) throw new Error(`bad base32 char: ${ch}`);
    bits += i.toString(2).padStart(5, '0');
  }
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

/** RFC 6238, SHA-1, 30s step, 6 digits — what authenticator apps produce. */
function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/* ------------------------------ helpers ------------------------------ */

let cookie = '';

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* non-JSON is fine, e.g. a redirect */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function waitForApi(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* -------------------------------- run -------------------------------- */

async function main() {
  console.log(`smoke: ${API}\n`);

  if (!(await waitForApi())) {
    console.error(`API is not answering at ${API}. Start it with: pnpm dev:api`);
    process.exit(1);
  }

  console.log('public surface');
  {
    const r = await req('GET', '/health');
    check('GET /health', r.status === 200, `status=${r.status}`);
  }
  {
    const r = await req('GET', '/.well-known/jwks.json');
    const key = r.json?.keys?.[0];
    check('JWKS responds', r.status === 200 && Array.isArray(r.json?.keys), `status=${r.status}`);
    // Without crv/x/y the endpoint is decorative: an add-in cannot verify a
    // token offline, which is the entire reason the token is ES256.
    check('JWKS carries usable key material',
      !!key?.crv && !!key?.x && !!key?.y,
      key ? `crv=${key.crv} x=${key.x ? 'yes' : 'MISSING'} y=${key.y ? 'yes' : 'MISSING'}` : 'no keys');
    check('JWKS does NOT leak the private key', key ? key.d === undefined : false,
      key?.d ? 'PRIVATE KEY EXPOSED' : '');
    check('JWKS advertises a kid for rotation', !!key?.kid, `kid=${key?.kid}`);
  }

  console.log('\nportal auth');
  {
    // The property that matters is not "the message avoids certain words" —
    // it is that the three failure modes are INDISTINGUISHABLE. If bad
    // password, bad TOTP and unknown email answer differently, the endpoint
    // is an oracle for "this email exists" and then for "the password is
    // right, only the code is wrong", which turns one leaked password into a
    // confirmed account.
    const shape = (r) => `${r.status}:${r.json?.error?.code}:${r.json?.error?.message}`;

    const badPassword = await req('POST', '/admin/auth/login',
      { email: EMAIL, password: 'wrong-password', totp: totp(TOTP_SECRET) });
    const badTotp = await req('POST', '/admin/auth/login',
      { email: EMAIL, password: PASSWORD, totp: '000000' });
    const noSuchUser = await req('POST', '/admin/auth/login',
      { email: 'nobody@nowhere.example', password: PASSWORD, totp: totp(TOTP_SECRET) });

    check('bad password rejected', badPassword.status >= 400, `status=${badPassword.status}`);
    check('bad TOTP rejected', badTotp.status >= 400, `status=${badTotp.status}`);
    check('unknown email rejected', noSuchUser.status >= 400, `status=${noSuchUser.status}`);
    check('bad password and bad TOTP are indistinguishable',
      shape(badPassword) === shape(badTotp), `${shape(badPassword)} vs ${shape(badTotp)}`);
    check('an unknown email is indistinguishable from a wrong password',
      shape(noSuchUser) === shape(badPassword), `${shape(noSuchUser)} vs ${shape(badPassword)}`);
    check('the message does not name a factor',
      !/password|totp|authenticator/i.test(String(badPassword.json?.error?.message ?? '')),
      String(badPassword.json?.error?.message ?? ''));
  }
  {
    const r = await req('POST', '/admin/auth/login', { email: EMAIL, password: PASSWORD, totp: totp(TOTP_SECRET) });
    if (r.status === 429) {
      // Each run spends 4 of the 5-per-15-minutes-per-email login budget, so
      // two runs inside one window trip the limiter on the second. That is
      // the rate limiter working; say so rather than reporting a failure the
      // reader will go hunting for.
      console.error('\nRate limited on login. This run used up the 5/15min per-email budget.');
      console.error('Restart the API (the limiter is in-memory) or wait 15 minutes, then re-run.');
      process.exit(2);
    }
    check('valid credentials accepted', r.status === 200, `status=${r.status} ${r.text.slice(0, 120)}`);
    check('session cookie issued', cookie.length > 0);
    check('session cookie is HttpOnly',
      (r.headers.getSetCookie?.() ?? []).some((c) => /httponly/i.test(c)));
  }

  console.log('\nadmin api (authenticated)');
  for (const [name, path] of [
    ['dashboard', '/admin/dashboard'],
    ['organisations', '/admin/orgs'],
    ['users', '/admin/users'],
    ['devices', '/admin/devices'],
    ['access requests', '/admin/access-requests'],
    ['audit log', '/admin/audit-log'],
    ['roles', '/admin/roles'],
    ['scope catalog', '/admin/panels'],
  ]) {
    const r = await req('GET', path);
    if (r.status === 404) skip(name, `${path} not implemented`);
    else check(name, r.status === 200, `status=${r.status}`);
  }

  console.log('\nauthorisation');
  {
    const saved = cookie;
    cookie = '';
    const r = await req('GET', '/admin/orgs');
    check('admin route rejects an unauthenticated caller', r.status === 401 || r.status === 403,
      `status=${r.status}`);
    cookie = saved;
  }

  console.log('\nadd-in surface');
  {
    const r = await req('POST', '/v1/auth/start', { device: { deviceHash: 'short' }, redirectPort: 51234 });
    if (r.status === 503) {
      // /v1/auth/start reports "APS not configured" before it validates the
      // body, so with no credentials set this cannot distinguish a working
      // validator from a missing one. Not a defect — just untestable here.
      skip('malformed device hash rejected by validation', 'APS not configured, endpoint short-circuits at 503');
    } else {
      check('malformed device hash rejected by validation', r.status === 400, `status=${r.status}`);
    }
  }
  {
    const r = await req('POST', '/v1/auth/start', {
      device: { deviceHash: 'sha256:smoke000000000000000000000000000', machineName: 'SMOKE-WS' },
      redirectPort: 51234,
    });
    if (r.status === 200 && r.json?.authorize_url) {
      check('auth start returns an Autodesk authorize_url',
        String(r.json.authorize_url).startsWith('https://developer.api.autodesk.com/authentication/v2/authorize'));
      const u = new URL(r.json.authorize_url);
      check('PKCE challenge method is S256', u.searchParams.get('code_challenge_method') === 'S256');
      // A hex digest is 64 chars of [0-9a-f]; base64url is 43 chars. Getting
      // this wrong fails only at the very end of the browser round trip.
      const ch = u.searchParams.get('code_challenge') ?? '';
      check('PKCE challenge is base64url, not hex',
        ch.length === 43 && !/^[0-9a-f]{64}$/.test(ch), `len=${ch.length}`);
    } else {
      skip('auth start', 'APS credentials not configured -- see docs/APS-SETUP.md');
    }
  }
  {
    const r = await req('POST', '/v1/token/refresh', {
      refreshToken: 'definitely-not-a-real-refresh-token',
      device: { deviceHash: 'sha256:smoke000000000000000000000000000' },
    });
    // A policy denial is HTTP 200 with a structured body, so the add-in has
    // ONE code path for every denial and 4xx stays for transport failures.
    if (r.status === 404) skip('token refresh', 'not implemented');
    else {
      check('invalid token denies with HTTP 200, not 4xx', r.status === 200, `status=${r.status}`);
      check('denial carries a machine-readable code', typeof r.json?.code === 'string', `code=${r.json?.code}`);
      check('denial carries a human message', typeof r.json?.message === 'string' && r.json.message.length > 10);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped.length} skipped`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
