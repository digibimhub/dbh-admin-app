import {
  createHash, createCipheriv, createDecipheriv, randomBytes,
  generateKeyPairSync, createPublicKey,
} from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id, OWASP's 19 MiB / t=2 / p=1 profile.
 *
 * @node-rs/argon2 defaults to Argon2id v19, but a default is not a guarantee:
 * `crypto.test.ts` asserts the encoded `$argon2id$v=19$m=19456,t=2,p=1$`
 * prefix, so a dependency bump cannot silently downgrade us to Argon2i.
 */
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/**
 * A real Argon2id digest, generated with exactly ARGON_OPTS, of a value no
 * account uses. dummyPasswordVerify() verifies against it so the missing-user
 * path runs the identical code path and the identical KDF cost as a real
 * login — not merely a similarly-priced one. Params are read from this string,
 * so hash-side and verify-side cost cannot drift apart.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$FZ0h4iFsjZytVc6FCpAfiQ$nN9L5yGKR+Lnpx6P2d/2mpILDhPgntcsz0SD5dKyIqM';

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Always run a real Argon2id verify so a login for an address that does not
 * exist takes the same wall-clock time as one that does. Without this, response
 * timing is an oracle for which emails have accounts.
 *
 * Never throws: a throw here would itself be a timing/behaviour signal.
 */
export async function dummyPasswordVerify(): Promise<void> {
  try {
    await verify(DUMMY_HASH, 'timing-dummy-password-value');
  } catch {
    /* unreachable in practice; swallowed so the caller cannot branch on it */
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** SHA-256 as unpadded base64url — the encoding RFC 7636 requires for PKCE S256. */
export function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error('ENCRYPTION_KEY is not set');
  // Buffer.from(_, 'base64') silently discards characters outside the alphabet,
  // so a mistyped key can still decode to the right length. Reject the junk
  // first rather than encrypt everything under a quietly truncated key.
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) {
    throw new Error('ENCRYPTION_KEY must be base64');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes base64');
  return buf;
}

const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * AES-256-GCM. Output: base64(iv || tag || ciphertext).
 *
 * The 12-byte IV is drawn fresh from the CSPRNG on every call and stored with
 * the record, so it is never reused across records under the same key —
 * GCM nonce reuse leaks the keystream and the authentication subkey.
 *
 * `aad` is authenticated but not encrypted. Pass a stable record identity
 * (e.g. `portal_user:<id>:totp_secret`) to bind a ciphertext to its own row,
 * so a blob lifted out of one row cannot be pasted into another and still
 * decrypt.
 */
export function encryptAtRest(plaintext: string, aad?: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Throws on any tampering — a wrong tag, a flipped byte, or a mismatched `aad`. */
export function decryptAtRest(payload: string, aad?: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('ciphertext is truncated');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function generateEs256Pair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/**
 * Derive the SPKI public PEM from a PKCS#8 private PEM.
 *
 * Deployments configure only the private key, so without this the JWKS
 * endpoint has no key material to publish and every add-in in the field loses
 * the ability to verify tokens offline.
 */
export function publicPemFromPrivatePem(privatePem: string): string {
  return createPublicKey(privatePem).export({ type: 'spki', format: 'pem' }).toString();
}
