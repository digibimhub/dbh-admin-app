import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, importPKCS8 } from 'jose';
import {
  signPortalJwt, verifyPortalJwt,
  signAddinJwt, verifyAddinJwt, addinTokenKid,
  publicJwkFromPem, buildJwks,
  type PortalClaims,
} from './tokens.ts';
import { generateEs256Pair } from './crypto.ts';
import type { AddinTokenClaims } from '@app/shared';

const KEY_A = generateEs256Pair();
const KEY_B = generateEs256Pair();
const ISSUER = 'https://api.yourco.com';

const PORTAL_SECRET = 'a-portal-secret-of-at-least-32-characters';
let savedSecret: string | undefined;

before(() => {
  savedSecret = process.env.JWT_PORTAL_SECRET;
  process.env.JWT_PORTAL_SECRET = PORTAL_SECRET;
});
after(() => {
  if (savedSecret === undefined) delete process.env.JWT_PORTAL_SECRET;
  else process.env.JWT_PORTAL_SECRET = savedSecret;
});

const CLAIMS: Omit<AddinTokenClaims, 'iss' | 'exp'> = {
  sub: 'org-user-1',
  org: 'org-a',
  org_name: 'Alec Engineering',
  email: 'j.smith@alec.in',
  role: 'admin',
  scopes: ['cleanup', 'parameters', 'excel', 'general'],
  license_end: '2026-12-31',
  grace_days: 7,
  next_check: '2026-08-29T09:00:00Z',
};

const signWith = (key = KEY_A, kid = 'k2026a', ttlSec?: number) =>
  signAddinJwt({ privatePem: key.privatePem, kid, issuer: ISSUER, claims: CLAIMS, ttlSec });

/* ---------------- add-in token: ES256 ---------------- */

describe('add-in token round trip', () => {
  test('signs and verifies, preserving every claim the add-in reads', async () => {
    const token = await signWith();
    const claims = await verifyAddinJwt(token, KEY_A.publicPem, ISSUER);
    assert.equal(claims.sub, CLAIMS.sub);
    assert.equal(claims.org, CLAIMS.org);
    assert.equal(claims.org_name, CLAIMS.org_name);
    assert.equal(claims.role, 'admin');
    assert.deepEqual(claims.scopes, CLAIMS.scopes);
    assert.equal(claims.license_end, '2026-12-31');
    assert.equal(claims.grace_days, 7);
    assert.equal(claims.iss, ISSUER);
    assert.equal(typeof claims.exp, 'number');
  });

  test('header carries alg ES256 and the kid, so keys rotate without a new DLL', async () => {
    const token = await signWith(KEY_A, 'k2026b');
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString());
    assert.equal(header.alg, 'ES256');
    assert.equal(header.kid, 'k2026b');
    assert.equal(addinTokenKid(token), 'k2026b');
  });

  test('a token signed by a different key is rejected', async () => {
    // The whole offline-verification model rests on this: a patched DLL that
    // mints its own token must not verify against the shipped public key.
    const forged = await signWith(KEY_B);
    await assert.rejects(() => verifyAddinJwt(forged, KEY_A.publicPem, ISSUER), /signature/i);
  });

  test('a token verified against the wrong published key is rejected', async () => {
    const token = await signWith(KEY_A);
    await assert.rejects(() => verifyAddinJwt(token, KEY_B.publicPem, ISSUER), /signature/i);
  });

  test('a tampered scope list is rejected', async () => {
    // The forgery that matters: grant yourself a capability the server did not.
    // Scopes are what the add-in gates features on, so this is the payload edit
    // a patched DLL would attempt.
    const token = await signWith();
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.scopes = [...payload.scopes, 'coordination'];
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    await assert.rejects(() => verifyAddinJwt(forged, KEY_A.publicPem, ISSUER), /signature/i);
  });

  test('a token from another issuer is rejected', async () => {
    const token = await signWith();
    await assert.rejects(
      () => verifyAddinJwt(token, KEY_A.publicPem, 'https://evil.example'),
      /"iss" claim/
    );
  });

  test('an expired token is rejected', async () => {
    const key = await importPKCS8(KEY_A.privatePem, 'ES256');
    const expired = await new SignJWT({ ...CLAIMS })
      .setProtectedHeader({ alg: 'ES256', kid: 'k2026a' })
      .setIssuer(ISSUER)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key);
    await assert.rejects(() => verifyAddinJwt(expired, KEY_A.publicPem, ISSUER), /expired/i);
  });

  test('an alg:none token is rejected', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k2026a' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ ...CLAIMS, iss: ISSUER, exp: 4102444800 })).toString('base64url');
    await assert.rejects(() => verifyAddinJwt(`${header}.${payload}.`, KEY_A.publicPem, ISSUER));
  });

  test('a portal HS256 token is rejected by the add-in verifier', async () => {
    // Algorithm confusion: the add-in verifier must never accept a token from
    // the symmetric portal path, whatever its header says.
    const hs = await signPortalJwt({ sub: 'u1', role: 'owner', epoch: 1, typ: 'session' });
    await assert.rejects(() => verifyAddinJwt(hs, KEY_A.publicPem, ISSUER));
  });

  /**
   * `role` is a role KEY now, not a two-value enum, so an unfamiliar role name
   * is legitimately valid — that is the point of roles being data. What is
   * still rejected is a value that could not be a key at all.
   */
  test('a role that could not be a key is rejected', async () => {
    const key = await importPKCS8(KEY_A.privatePem, 'ES256');
    const bad = await new SignJWT({ ...CLAIMS, role: 'Not A Key' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k2026a' })
      .setIssuer(ISSUER).setIssuedAt().setExpirationTime('1h')
      .sign(key);
    await assert.rejects(() => verifyAddinJwt(bad, KEY_A.publicPem, ISSUER));
  });

  test('a malformed scope list is rejected — it is the add-in contract', async () => {
    const key = await importPKCS8(KEY_A.privatePem, 'ES256');
    const bad = await new SignJWT({ ...CLAIMS, scopes: 'cleanup' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k2026a' })
      .setIssuer(ISSUER).setIssuedAt().setExpirationTime('1h')
      .sign(key);
    await assert.rejects(() => verifyAddinJwt(bad, KEY_A.publicPem, ISSUER));
  });

  test('default lifetime is 24h and ttlSec overrides it', async () => {
    const now = Math.floor(Date.now() / 1000);
    const dflt = await verifyAddinJwt(await signWith(), KEY_A.publicPem, ISSUER);
    assert.ok(Math.abs(dflt.exp - (now + 86400)) <= 5, `exp was ${dflt.exp - now}s out`);

    const short = await verifyAddinJwt(await signWith(KEY_A, 'k2026a', 60), KEY_A.publicPem, ISSUER);
    assert.ok(Math.abs(short.exp - (now + 60)) <= 5);
  });
});

/* ---------------- JWKS ---------------- */

describe('JWKS export', () => {
  test('a JWK carries real key material, not just an identifier', async () => {
    // A JWKS listing only kty/kid parses fine and verifies nothing — an add-in
    // that fetches one silently loses offline verification.
    const jwk = await publicJwkFromPem('k2026a', KEY_A.publicPem);
    assert.equal(jwk.kty, 'EC');
    assert.equal(jwk.crv, 'P-256');
    assert.equal(typeof jwk.x, 'string');
    assert.equal(typeof jwk.y, 'string');
    assert.equal(jwk.kid, 'k2026a');
    assert.equal(jwk.use, 'sig');
    assert.equal(jwk.alg, 'ES256');
  });

  test('the private half never leaks into the JWK', async () => {
    const jwk = await publicJwkFromPem('k2026a', KEY_A.publicPem);
    assert.equal('d' in jwk, false, 'JWKS would have published the signing key');
  });

  test('buildJwks returns { keys: [...] } with one entry per signing key', async () => {
    const jwks = await buildJwks([
      { kid: 'k2026a', publicPem: KEY_A.publicPem },
      { kid: 'k2026b', publicPem: KEY_B.publicPem },
    ]);
    assert.equal(Array.isArray(jwks.keys), true);
    assert.equal(jwks.keys.length, 2);
    assert.deepEqual(jwks.keys.map((k) => k.kid), ['k2026a', 'k2026b']);
    // Rotation only works if the entries are actually different keys.
    assert.notEqual(jwks.keys[0]!.x, jwks.keys[1]!.x);
  });

  test('an empty key list is a valid, empty JWKS', async () => {
    assert.deepEqual(await buildJwks([]), { keys: [] });
  });

  test('a published JWK verifies a token minted by its private key', async () => {
    // End to end: the exact bytes the endpoint serves must verify a real token.
    const { importJWK, jwtVerify } = await import('jose');
    const jwks = await buildJwks([{ kid: 'k2026a', publicPem: KEY_A.publicPem }]);
    const token = await signWith(KEY_A, 'k2026a');
    const entry = jwks.keys.find((k) => k.kid === addinTokenKid(token));
    assert.ok(entry);
    const key = await importJWK(entry, 'ES256');
    const { payload } = await jwtVerify(token, key, { algorithms: ['ES256'], issuer: ISSUER });
    assert.equal(payload.sub, CLAIMS.sub);
  });
});

/* ---------------- portal token ---------------- */

describe('portal token', () => {
  const base: Omit<PortalClaims, 'iat' | 'exp'> = {
    sub: 'portal-1', role: 'owner', epoch: 3, typ: 'session',
  };

  test('round-trips the claims the session middleware relies on', async () => {
    const claims = await verifyPortalJwt(await signPortalJwt(base));
    assert.equal(claims.sub, 'portal-1');
    assert.equal(claims.role, 'owner');
    assert.equal(claims.epoch, 3);
    assert.equal(claims.typ, 'session');
  });

  test('an enrolment token is distinguishable from a session token', async () => {
    const claims = await verifyPortalJwt(await signPortalJwt({ ...base, typ: 'enrol' }, 1800));
    assert.equal(claims.typ, 'enrol');
  });

  test('a token signed with a different secret is rejected', async () => {
    const token = await signPortalJwt(base);
    process.env.JWT_PORTAL_SECRET = 'a-completely-different-secret-32-chars';
    try {
      await assert.rejects(() => verifyPortalJwt(token), /signature/i);
    } finally {
      process.env.JWT_PORTAL_SECRET = PORTAL_SECRET;
    }
  });

  test('an ES256 token is rejected by the portal verifier', async () => {
    const token = await signWith();
    await assert.rejects(() => verifyPortalJwt(token));
  });

  test('a token missing epoch is rejected, so revocation cannot be bypassed', async () => {
    const { SignJWT: S } = await import('jose');
    const token = await new S({ sub: 'portal-1', role: 'owner', typ: 'session' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(PORTAL_SECRET));
    await assert.rejects(() => verifyPortalJwt(token), /invalid portal claims/);
  });

  test('a short JWT_PORTAL_SECRET fails closed at sign and verify', async () => {
    // HS256 with a weak key is brute-forceable offline from one captured
    // cookie, which forges any role including owner.
    process.env.JWT_PORTAL_SECRET = 'too-short';
    try {
      await assert.rejects(() => signPortalJwt(base), /at least 32 characters/);
      await assert.rejects(() => verifyPortalJwt('a.b.c'), /at least 32 characters/);
    } finally {
      process.env.JWT_PORTAL_SECRET = PORTAL_SECRET;
    }
  });

  test('a missing JWT_PORTAL_SECRET fails closed', async () => {
    delete process.env.JWT_PORTAL_SECRET;
    try {
      await assert.rejects(() => signPortalJwt(base), /is not set/);
    } finally {
      process.env.JWT_PORTAL_SECRET = PORTAL_SECRET;
    }
  });
});
