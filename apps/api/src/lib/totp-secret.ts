import { decryptAtRest, encryptAtRest } from '@app/core';
import { env } from '../env';

/**
 * `portal_users.totp_secret_enc` holds an AES-256-GCM ciphertext.
 *
 * The column name always promised that; the API used to write and read the
 * raw base32 secret, so anyone with a read-only DATABASE_URL — a replica, a
 * backup, an analytics grant — could generate valid codes for every portal
 * user and the second factor was decorative. Everything that touches the
 * column now goes through these two functions.
 */
export function sealTotpSecret(secret: string): string {
  return encryptAtRest(secret);
}

/** Base32 alphabet used by otpauth secrets. */
const BASE32 = /^[A-Z2-7]{16,64}=*$/;

/**
 * Returns the plaintext secret, or null if the stored value cannot be used.
 *
 * Legacy fallback, for local databases seeded before the seed encrypted (it
 * does now) and for one seeded under a different ENCRYPTION_KEY. Rather than
 * send a developer hunting for why login broke, a value that fails to decrypt
 * is accepted as a raw base32 secret — but only outside production. In
 * production a secret we cannot decrypt is a corrupted or tampered row and
 * must fail closed, because the alternative is accepting an attacker-supplied
 * plaintext secret. Re-running `pnpm db:seed` clears the fallback path.
 */
export function openTotpSecret(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decryptAtRest(stored);
  } catch {
    if (env.nodeEnv === 'production') return null;
    return BASE32.test(stored) ? stored : null;
  }
}

/**
 * The enrolment secret has to survive the round trip between "show me a QR
 * code" and "here is a code from my authenticator", and there is no table to
 * park it in. It rides in the enrolment cookie — but a JWT payload is
 * base64, not ciphertext, so anyone who sees the cookie could read a
 * plaintext secret out of it and enrol their own authenticator. Sealing it
 * means the cookie is useless without the server's encryption key.
 */
export function sealPendingSecret(secret: string): string {
  return encryptAtRest(secret, 'portal_user:totp_enrolment');
}

export function openPendingSecret(sealed: string | undefined): string | null {
  if (!sealed) return null;
  try {
    return decryptAtRest(sealed, 'portal_user:totp_enrolment');
  } catch {
    return null;
  }
}
