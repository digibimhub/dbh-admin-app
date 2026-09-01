import { expect, request, type APIRequestContext, type Cookie } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lastCounter, recordCounter, storageStatePath } from './state';

/**
 * Everything the portal specs need in order to be somebody, plus the add-in
 * sign-in the journey spec closes with.
 *
 * This file exists because three separate constraints — single-use TOTP codes,
 * a five-per-fifteen-minutes login budget, and two API instances sharing one
 * database — are only manageable from ONE place. A second copy of the login
 * helper would quietly spend the same budget twice.
 */

export const API = process.env.E2E_API_URL ?? 'http://localhost:3002';
export const MOCK = process.env.MOCK_APS_URL ?? 'http://127.0.0.1:4599';

export const PORTAL_PASSWORD = 'localdev-password';
export const PORTAL_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

export const PORTAL_EMAIL = {
  owner: 'admin@yourco.local',
  support: 'support@yourco.local',
  viewer: 'viewer@yourco.local',
} as const;

export type PortalRoleName = keyof typeof PORTAL_EMAIL;

/* ------------------------------------------------------------------ TOTP */

function base32Decode(s: string): Buffer {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    bits += A.indexOf(ch).toString(2).padStart(5, '0');
  }
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export function totp(secret: string, at = Date.now()): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A code from a 30-second window this process has not already spent.
 *
 * `verifyTotpWithReplay` records the MINTED counter on the portal user row, so
 * a code is dead the moment it is accepted — including for the rest of its own
 * validity window. That row is shared by the API on :3001 and the one on :3002,
 * so a login here and a step-up in the browser compete for the same counters.
 * Tracking them per email and waiting for the next boundary is what lets a
 * suite contain several step-ups.
 */
export async function freshTotp(email: string, secret = PORTAL_TOTP_SECRET): Promise<string> {
  for (;;) {
    const counter = Math.floor(Date.now() / 1000 / 30);
    if (lastCounter(email) < counter) {
      recordCounter(email, counter);
      return totp(secret, Date.now());
    }
    // Land just inside the next window rather than exactly on its edge.
    await sleep(30_000 - (Date.now() % 30_000) + 750);
  }
}

/* --------------------------------------------------------------- sessions */

const sessions = new Map<PortalRoleName, Promise<APIRequestContext>>();

/** A logged-in API context for one portal role. One login per role, per run. */
export function portalApi(role: PortalRoleName = 'owner'): Promise<APIRequestContext> {
  const existing = sessions.get(role);
  if (existing) return existing;

  const opening = (async () => {
    const email = PORTAL_EMAIL[role];
    const file = storageStatePath(role);

    // A session this run already paid for. Worker restarts are free; a second
    // login would not be.
    if (existsSync(file)) return request.newContext({ storageState: file });

    const api = await request.newContext();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await api.post(`${API}/admin/auth/login`, {
        data: { email, password: PORTAL_PASSWORD, totp: await freshTotp(email) },
      });
      if (res.status() === 200) {
        await api.storageState({ path: file });
        return api;
      }
      if (attempt === 3) {
        expect(res.status(), `login for ${email}: ${await res.text()}`).toBe(200);
      }
      // Almost always a counter this run did not know was already spent.
      await sleep(30_000 - (Date.now() % 30_000) + 750);
    }
    return api;
  })();

  sessions.set(role, opening);
  return opening;
}

/** The cookie a browser context needs in order to be this role. */
export async function sessionCookie(role: PortalRoleName = 'owner'): Promise<Cookie> {
  const api = await portalApi(role);
  const { cookies } = await api.storageState();
  const session = cookies.find((c) => c.name === 'portal_session');
  expect(session, `no portal session cookie for ${role}`).toBeTruthy();
  return { ...session!, domain: 'localhost', path: '/' };
}

/** Prove a fresh authenticator code to the API, for the routes that demand it. */
export async function stepUp(api: APIRequestContext, role: PortalRoleName = 'owner'): Promise<void> {
  const email = PORTAL_EMAIL[role];
  const res = await api.post(`${API}/admin/auth/step-up`, {
    data: { totp: await freshTotp(email) },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/* ------------------------------------------------------------- add-in --- */

export type Identity = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
};

export type Grant =
  | { status: 'ok'; access_token: string; refresh_token: string; scopes: string[]; role: string }
  | { status: 'denied'; code: string; message: string; action: string };

/**
 * What LicenseClient.dll does: start, follow the browser handoff, exchange.
 *
 * The redirect chain is followed with plain fetch rather than a browser
 * because that is what the add-in's embedded flow does — it opens a browser,
 * and a loopback listener catches the final redirect.
 */
export async function addinSignIn(
  api: APIRequestContext,
  identity: Identity,
  deviceHash: string,
): Promise<Grant> {
  // Who the mock issuer will be for the next authorize call.
  await api.post(`${MOCK}/__identity`, {
    data: { email_verified: true, ...identity },
  });

  const started = await api.post(`${API}/v1/auth/start`, {
    // The add-in sends this, and the /v1 rate limiter buckets on it — so a
    // busy workstation cannot exhaust the allowance for a whole office behind
    // one NAT address. Omitting it here would put every test in one bucket.
    headers: { 'x-device-hash': deviceHash },
    data: {
      device: { deviceHash, machineName: 'E2E-WS', revitVersion: '2026.1', addinVersion: '1.4.2' },
      redirectPort: 51234,
    },
  });
  expect(started.status(), await started.text()).toBe(200);
  const { authorize_url } = await started.json() as { authorize_url: string };

  // The browser leg: authorize -> our callback -> loopback redirect carrying
  // the handoff. `maxRedirects: 0` lets us read the loopback URL rather than
  // trying to connect to a listener that only exists inside Revit.
  const authorized = await api.get(authorize_url, { maxRedirects: 0 });
  const toCallback = authorized.headers()['location'];
  expect(toCallback, 'issuer did not redirect back').toBeTruthy();

  const callback = await api.get(toCallback!, { maxRedirects: 0 });
  const loopback = callback.headers()['location'];
  expect(loopback, 'callback did not redirect to the loopback listener').toBeTruthy();

  const handoff = new URL(loopback!).searchParams.get('handoff');
  expect(handoff, 'no handoff in the loopback redirect').toBeTruthy();

  const exchanged = await api.post(`${API}/v1/auth/exchange`, {
    headers: { 'x-device-hash': deviceHash },
    data: { handoff },
  });
  expect(exchanged.status(), await exchanged.text()).toBe(200);
  return await exchanged.json() as Grant;
}

export async function refresh(
  api: APIRequestContext,
  refreshToken: string,
  deviceHash: string,
): Promise<Grant> {
  const res = await api.post(`${API}/v1/token/refresh`, {
    headers: { 'x-device-hash': deviceHash },
    data: {
      refreshToken,
      device: { deviceHash, machineName: 'E2E-WS', revitVersion: '2026.1', addinVersion: '1.4.2' },
      daysSinceLastSuccess: 0,
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return await res.json() as Grant;
}

/* ----------------------------------------------------------------- misc -- */

export const unique = () => Math.random().toString(36).slice(2, 8);

/** Create an organisation out of band, for specs whose subject is not the dialog. */
export async function createOrg(
  api: APIRequestContext,
  fields: { name: string; slug: string; primaryContactEmail?: string },
): Promise<{ id: string; name: string; slug: string }> {
  const res = await api.post(`${API}/admin/orgs`, { data: fields });
  expect(res.status(), await res.text()).toBe(201);
  const { row } = await res.json() as { row: { id: string; name: string; slug: string } };
  return row;
}
