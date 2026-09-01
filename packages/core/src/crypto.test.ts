import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import {
  hashPassword, verifyPassword, dummyPasswordVerify,
  sha256Hex, sha256Base64Url, randomToken,
  encryptAtRest, decryptAtRest,
  generateEs256Pair, publicPemFromPrivatePem,
} from './crypto.ts';

const KEY = randomBytes(32).toString('base64');
let savedKey: string | undefined;

before(() => {
  savedKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = KEY;
});

after(() => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedKey;
});

/** Flip one bit in the byte at `index` of a base64 blob. */
function tamper(payload: string, index: number): string {
  const buf = Buffer.from(payload, 'base64');
  buf[index] = (buf[index] ?? 0) ^ 0x01;
  return buf.toString('base64');
}

/* ---------------- argon2id ---------------- */

describe('password hashing', () => {
  test('hashPassword produces argon2id with the pinned parameters', async () => {
    // A default is not a guarantee. If @node-rs/argon2 ever changes its default
    // algorithm, this catches it here rather than in production.
    const h = await hashPassword('correct horse battery staple');
    assert.ok(
      h.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'),
      `unexpected argon2 encoding: ${h.slice(0, 40)}`,
    );
  });

  test('the same password hashes differently every time (random salt)', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    assert.notEqual(a, b);
  });

  test('verifyPassword accepts the right password and rejects the wrong one', async () => {
    const h = await hashPassword('s3cret-passphrase');
    assert.equal(await verifyPassword(h, 's3cret-passphrase'), true);
    assert.equal(await verifyPassword(h, 's3cret-passphras'), false);
    assert.equal(await verifyPassword(h, ''), false);
  });

  test('verifyPassword returns false on a malformed stored hash instead of throwing', async () => {
    assert.equal(await verifyPassword('not-a-phc-string', 'anything'), false);
    assert.equal(await verifyPassword('', 'anything'), false);
  });

  test('dummyPasswordVerify runs a real KDF, not a no-op', async () => {
    // The point of the dummy is that a login for an address with no account
    // costs the same as one that has an account. Compare it against a real
    // verify: a stub or an early return would show up as a fraction of the
    // cost. Generous bounds keep this from flaking on a loaded CI box.
    const h = await hashPassword('reference-password');
    await verifyPassword(h, 'reference-password');   // warm up
    await dummyPasswordVerify();

    const realStart = process.hrtime.bigint();
    await verifyPassword(h, 'wrong-password');
    const real = Number(process.hrtime.bigint() - realStart);

    const dummyStart = process.hrtime.bigint();
    await dummyPasswordVerify();
    const dummy = Number(process.hrtime.bigint() - dummyStart);

    assert.ok(dummy > real / 4, `dummy ${dummy}ns is far cheaper than a real verify ${real}ns`);
    assert.ok(dummy < real * 4, `dummy ${dummy}ns is far dearer than a real verify ${real}ns`);
  });

  test('dummyPasswordVerify never throws and never resolves to a value', async () => {
    assert.equal(await dummyPasswordVerify(), undefined);
  });
});

/* ---------------- digests ---------------- */

describe('digests', () => {
  test('sha256Hex matches the known NIST vector for "abc"', () => {
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('sha256Base64Url is unpadded base64url of the same digest', () => {
    const expected = createHash('sha256').update('abc').digest('base64url');
    assert.equal(sha256Base64Url('abc'), expected);
    assert.ok(!sha256Base64Url('abc').includes('='));
    assert.ok(!/[+/]/.test(sha256Base64Url('abc')));
  });

  test('randomToken is base64url and unpredictable', () => {
    const a = randomToken(32);
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, randomToken(32));
    assert.match(randomToken(16), /^[A-Za-z0-9_-]{22}$/);
  });
});

/* ---------------- AES-256-GCM ---------------- */

describe('encryptAtRest / decryptAtRest', () => {
  test('round-trips a TOTP secret', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    assert.equal(decryptAtRest(encryptAtRest(secret)), secret);
  });

  test('round-trips empty strings and multi-byte text', () => {
    assert.equal(decryptAtRest(encryptAtRest('')), '');
    const unicode = 'Alec Engineering — Ünïcøde ✔ 日本語';
    assert.equal(decryptAtRest(encryptAtRest(unicode)), unicode);
  });

  test('the IV is fresh per record, so identical plaintexts differ', () => {
    // GCM nonce reuse under one key leaks the keystream and the auth subkey.
    // Encrypting the same APS token for 200 records must never repeat an IV.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const blob = encryptAtRest('same-aps-refresh-token');
      const iv = Buffer.from(blob, 'base64').subarray(0, 12).toString('hex');
      assert.equal(seen.has(iv), false, `IV reused after ${seen.size} encryptions`);
      seen.add(iv);
    }
    assert.equal(seen.size, 200);
  });

  test('layout is iv(12) || tag(16) || ciphertext', () => {
    const blob = Buffer.from(encryptAtRest('0123456789'), 'base64');
    assert.equal(blob.length, 12 + 16 + 10);
  });

  test('a flipped ciphertext byte is detected', () => {
    const blob = encryptAtRest('sensitive-aps-access-token');
    assert.throws(() => decryptAtRest(tamper(blob, 30)), /unable to authenticate/i);
  });

  test('a flipped auth tag byte is detected', () => {
    const blob = encryptAtRest('sensitive-aps-access-token');
    assert.throws(() => decryptAtRest(tamper(blob, 12)), /unable to authenticate/i);
  });

  test('a flipped IV byte is detected', () => {
    const blob = encryptAtRest('sensitive-aps-access-token');
    assert.throws(() => decryptAtRest(tamper(blob, 0)), /unable to authenticate/i);
  });

  test('truncating the ciphertext is detected', () => {
    const blob = encryptAtRest('sensitive-aps-access-token');
    const short = Buffer.from(blob, 'base64').subarray(0, 34).toString('base64');
    assert.throws(() => decryptAtRest(short));
  });

  test('a payload shorter than iv+tag reports truncation, not a crypto error', () => {
    assert.throws(() => decryptAtRest(Buffer.alloc(20).toString('base64')), /truncated/);
    assert.throws(() => decryptAtRest(''), /truncated/);
  });

  test('a blob encrypted under a different key does not decrypt', () => {
    const blob = encryptAtRest('secret');
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    try {
      assert.throws(() => decryptAtRest(blob), /unable to authenticate/i);
    } finally {
      process.env.ENCRYPTION_KEY = KEY;
    }
  });

  test('aad binds a ciphertext to its own record', () => {
    // Without this, a DBA or an SQL-injection write can move user A's
    // encrypted TOTP secret onto user B's row and it still decrypts.
    const blob = encryptAtRest('JBSWY3DPEHPK3PXP', 'portal_user:aaa:totp_secret');
    assert.equal(decryptAtRest(blob, 'portal_user:aaa:totp_secret'), 'JBSWY3DPEHPK3PXP');
    assert.throws(() => decryptAtRest(blob, 'portal_user:bbb:totp_secret'), /unable to authenticate/i);
    assert.throws(() => decryptAtRest(blob), /unable to authenticate/i);
  });

  test('aad is not required, so existing unbound blobs still read', () => {
    const blob = encryptAtRest('legacy');
    assert.equal(decryptAtRest(blob), 'legacy');
    assert.throws(() => decryptAtRest(blob, 'unexpected'), /unable to authenticate/i);
  });
});

describe('ENCRYPTION_KEY validation', () => {
  const restore = (v: string | undefined) => {
    if (v === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = v;
  };

  test('a missing key fails closed', () => {
    delete process.env.ENCRYPTION_KEY;
    try {
      assert.throws(() => encryptAtRest('x'), /ENCRYPTION_KEY is not set/);
    } finally { restore(KEY); }
  });

  test('a key of the wrong length is rejected', () => {
    process.env.ENCRYPTION_KEY = randomBytes(16).toString('base64');
    try {
      assert.throws(() => encryptAtRest('x'), /32 bytes/);
    } finally { restore(KEY); }
  });

  test('a 64-char hex key is rejected rather than silently truncated', () => {
    // Base64-decoding hex yields 48 bytes, not 32 — a plausible copy/paste
    // mistake that must not produce a working-but-wrong key.
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    try {
      assert.throws(() => encryptAtRest('x'), /32 bytes/);
    } finally { restore(KEY); }
  });

  test('a key with characters outside the base64 alphabet is rejected', () => {
    // Buffer.from(_, 'base64') drops junk silently, so a mistyped key can still
    // decode to 32 bytes and quietly encrypt everything under the wrong key.
    process.env.ENCRYPTION_KEY = `${randomBytes(32).toString('base64')} oops!`;
    try {
      assert.throws(() => encryptAtRest('x'), /base64/);
    } finally { restore(KEY); }
  });
});

/* ---------------- ES256 keys ---------------- */

describe('ES256 key generation', () => {
  test('generates a P-256 PKCS#8 / SPKI pair', () => {
    const { privatePem, publicPem } = generateEs256Pair();
    assert.match(privatePem, /^-----BEGIN PRIVATE KEY-----/);
    assert.match(publicPem, /^-----BEGIN PUBLIC KEY-----/);
    assert.notEqual(generateEs256Pair().privatePem, privatePem);
  });

  test('publicPemFromPrivatePem recovers the matching public key', () => {
    // Deployments configure only JWT_SIGNING_KEY_PEM, so the JWKS endpoint has
    // to derive the public half or it publishes nothing an add-in can use.
    const { privatePem, publicPem } = generateEs256Pair();
    assert.equal(publicPemFromPrivatePem(privatePem).trim(), publicPem.trim());
  });

  test('a different private key derives a different public key', () => {
    const a = generateEs256Pair();
    const b = generateEs256Pair();
    assert.notEqual(publicPemFromPrivatePem(a.privatePem), publicPemFromPrivatePem(b.privatePem));
  });
});
