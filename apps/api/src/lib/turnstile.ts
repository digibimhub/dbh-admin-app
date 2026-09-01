import { env } from '../env';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile check for the login form.
 *
 * Skipped when TURNSTILE_SECRET is unset so local development and the seeded
 * dev login keep working. In production an unset secret would silently
 * disable the bot check, so `index.ts` refuses to boot without one.
 *
 * The response is a bare boolean on purpose: the caller answers every login
 * failure with the same generic message, and Cloudflare's error codes would
 * tell an attacker which factor tripped.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!env.turnstileSecret) return true;
  if (!token) return false;

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.turnstileSecret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const json = await res.json() as { success?: boolean };
    return json.success === true;
  } catch {
    // Network failure. Fail closed — an unreachable bot check is not a reason
    // to hand out sessions.
    return false;
  }
}
