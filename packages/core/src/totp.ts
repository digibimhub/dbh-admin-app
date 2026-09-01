import * as OTPAuth from 'otpauth';

/**
 * Well-known RFC 4226 test secret. Local development only — it exists so
 * `pnpm totp` can print a code for the seeded admin without an authenticator
 * app. Never assign it to a real portal user.
 */
export const DEV_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

/** The RFC 6238 time step a timestamp falls in: floor(seconds / 30). */
export function totpCounter(now = Date.now()): number {
  return Math.floor(now / 1000 / 30);
}

export function makeTotp(secret: string, label = 'dbh-admin'): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: 'DIGIBIM HUB',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
}

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, email: string): string {
  return makeTotp(secret, email).toString();
}

/**
 * Verify a 6-digit code, accepting one period either side of now to absorb
 * clock skew.
 *
 * `counter` is the step the code was actually MINTED for, not the step it was
 * presented in. Storing the minted step is what closes the window: a code
 * generated at step N and accepted at step N+1 records N, so replaying it
 * during the rest of its validity fails the `counter <= last` test. Recording
 * the presentation step instead would leave the same code replayable for the
 * remainder of the window.
 *
 * Callers MUST still apply the replay guard — use verifyTotpWithReplay.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): { ok: true; counter: number } | { ok: false } {
  const totp = makeTotp(secret);
  const delta = totp.validate({ token: code, timestamp: now, window: 1 });
  if (delta === null) return { ok: false };
  const counter = totpCounter(now) + delta;
  return { ok: true, counter };
}

/**
 * Verify plus the replay guard in one call, so no caller can forget the guard.
 *
 * A TOTP code stays valid for its whole period (plus the skew window), which
 * is ample time to reuse one lifted from a phishing page or a shoulder-surf.
 * Rejecting `counter <= lastCounter` makes every code single-use.
 *
 * On success the caller must persist `counter` to `last_totp_counter` in the
 * same transaction that establishes the session — otherwise the guard has
 * nothing to compare against next time.
 */
export function verifyTotpWithReplay(
  secret: string,
  code: string,
  lastCounter: number,
  now = Date.now(),
): { ok: true; counter: number } | { ok: false; reason: 'invalid' | 'replayed' } {
  const check = verifyTotp(secret, code, now);
  if (!check.ok) return { ok: false, reason: 'invalid' };
  if (check.counter <= lastCounter) return { ok: false, reason: 'replayed' };
  return { ok: true, counter: check.counter };
}

export function currentTotp(secret: string, now = Date.now()): string {
  return makeTotp(secret).generate({ timestamp: now });
}
