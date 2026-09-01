import type { Context, Next } from 'hono';
import { HttpError } from '../lib/errors';

interface Bucket { count: number; resetAt: number }

const buckets = new Map<string, Bucket>();
let sweepCounter = 0;

/**
 * Drop expired buckets periodically. Without this the map grows one entry per
 * distinct device hash forever, which on a public endpoint is a slow leak an
 * attacker controls.
 */
function maybeSweep(now: number): void {
  if (++sweepCounter < 1000) return;
  sweepCounter = 0;
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}

function hit(key: string, windowMs: number, max: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  maybeSweep(now);
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  cur.count += 1;
  if (cur.count > max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

export function rateLimit(opts: { windowMs: number; max: number; key: (c: Context) => string; bucket?: string }) {
  return async (c: Context, next: Next) => {
    const prefix = opts.bucket ?? 'default';
    const res = hit(`${prefix}:${opts.key(c)}`, opts.windowMs, opts.max);
    if (!res.ok) {
      c.header('retry-after', String(res.retryAfter));
      throw new HttpError(429, 'rate_limited', 'Too many requests');
    }
    await next();
  };
}

/**
 * Imperative variant for limits that depend on the request body — the login
 * route needs a per-email counter, which middleware cannot see.
 */
export function consumeRateLimit(bucket: string, key: string, windowMs: number, max: number): void {
  const res = hit(`${bucket}:${key}`, windowMs, max);
  if (!res.ok) throw new HttpError(429, 'rate_limited', 'Too many requests');
}

/** Test/seam helper — resets counters between runs. */
export function resetRateLimits(): void {
  buckets.clear();
}

export function clientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? c.req.header('x-real-ip')
    ?? '127.0.0.1';
}

/** Postgres `inet` rejects anything that is not an address, so validate first. */
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function clientIpOrNull(c: Context): string | null {
  const ip = clientIp(c);
  if (IPV4.test(ip) || (ip.includes(':') && IPV6.test(ip))) return ip;
  return null;
}
