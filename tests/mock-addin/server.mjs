/**
 * A web mock of the Revit ribbon, so the add-in client surface can be driven
 * end to end in a browser.
 *
 * WHAT THIS IS NOT: a second implementation of the licensing rules. It renders
 * exactly what `/v1/auth/exchange` and `/v1/token/refresh` return and decides
 * nothing for itself. Every panel it shows or hides is a membership test
 * against the `scopes` array the API signed — the same array that is inside the
 * JWT, verifiable against the JWKS. If this file ever grows a rule of its own,
 * the E2E stops testing the resolver and starts testing this.
 *
 * WHY A SERVER AND NOT A PAGE: the API's CORS allowlist is the portal origin
 * and nothing else, and it does not accept `x-device-hash` — which every /v1
 * call must send. A browser page on this origin therefore cannot call /v1 at
 * all. So the /v1 calls happen HERE, in node, and the browser only ever
 * navigates. That is also what the real add-in does: it opens a browser and
 * catches the redirect on a loopback listener. This process IS that listener,
 * which is why it passes its own port as `redirectPort`.
 *
 *   node tests/mock-addin/server.mjs      (or: pnpm mock:addin)
 *
 * The chain, with no CORS at any hop:
 *
 *   browser  --POST /__signin (same origin)-->  this server
 *                                                └─ POST :3002/v1/auth/start
 *   browser navigates to the issuer's authorize URL
 *     └─ 302 -> :3002/v1/auth/callback
 *          └─ 302 -> 127.0.0.1:4600/callback?result=…&handoff=…
 *               └─ this server POSTs /v1/auth/exchange and renders the ribbon
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.MOCK_ADDIN_PORT ?? 4600);
const API = process.env.E2E_API_URL ?? 'http://localhost:3002';
const MOCK_APS = process.env.MOCK_APS_URL ?? 'http://127.0.0.1:4599';

/**
 * The ribbon, as four groups over the six catalogue slugs.
 *
 * The slugs are the contract — they are compiled into shipped DLLs and the
 * catalogue is append-only — so the grouping lives here, in presentation,
 * rather than being pushed back into `panel_definitions`. A group renders when
 * the grant carries ANY of its slugs.
 *
 * `general` is never gated: the API unions it into every grant, including
 * denied ones, because it carries Sign in and About. If a licensing failure
 * could hide it, the failure would also remove the only means of fixing it.
 */
const RIBBON = [
  {
    id: 'protect',
    label: 'Protect',
    tone: 'crimson',
    buttons: [{ slug: 'troubleshoot', label: 'Diagnose Duplicates' }],
  },
  {
    id: 'review',
    label: 'Review',
    tone: 'slate',
    buttons: [
      { slug: 'coordination', label: 'Link Manager' },
      { slug: 'parameters', label: 'Mass Parameters' },
      { slug: 'excel', label: 'Export Excel' },
      { slug: 'excel', label: 'Import Excel' },
    ],
  },
  {
    id: 'produce',
    label: 'Produce',
    tone: 'blue',
    buttons: [{ slug: 'cleanup', label: 'Delete Duplicates' }],
  },
  {
    id: 'general',
    label: 'General',
    tone: 'grey',
    buttons: [
      { slug: 'general', label: 'Licence' },
      { slug: 'general', label: 'Settings' },
      { slug: 'general', label: 'Update' },
      { slug: 'general', label: 'About' },
    ],
  },
];

/**
 * One workstation per person.
 *
 * The device hash is what the /v1 rate limiter buckets on and what the resolver
 * looks up to check for a disabled workstation, so two mock users must not
 * share one. Deriving it from the email keeps it stable across a re-sign-in,
 * which is what makes the "same machine, seat freed" step meaningful.
 */
function deviceHashFor(email) {
  return `sha256:mock-${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
}

function deviceFor(email) {
  return {
    deviceHash: deviceHashFor(email),
    machineName: `MOCK-WS-${createHash('sha256').update(email).digest('hex').slice(0, 4).toUpperCase()}`,
    osVersion: 'Windows 11 Pro 26200',
    revitVersion: '2026.1',
    addinVersion: '1.4.2',
  };
}

/**
 * What the ribbon is currently showing. One session, because one mock is one
 * workstation — signing in as somebody else replaces the first, exactly as
 * switching accounts inside Revit would.
 */
let session = null;

function reset() {
  session = null;
}

/** The payload of an ES256 JWT, for display only. Never trusted for gating. */
function claims(token) {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

async function callApi(path, body, email) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-hash': deviceHashFor(email),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { status: 'denied', code: 'unparseable', message: text, action: '' };
  }
  return { status: res.status, body: parsed };
}

/* ------------------------------------------------------------------ view -- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function ribbonHtml(scopes) {
  return RIBBON.map((group) => {
    const visible = group.buttons.some((b) => scopes.includes(b.slug));
    if (!visible) return '';
    const buttons = group.buttons
      .filter((b) => scopes.includes(b.slug))
      .map((b) => `
        <button type="button" class="tool" data-slug="${esc(b.slug)}" aria-label="${esc(b.label)}">
          <span class="glyph tone-${esc(group.tone)}"></span>
          <span class="tool-label">${esc(b.label)}</span>
        </button>`)
      .join('');
    return `
      <section class="group" data-panel="${esc(group.id)}" aria-label="${esc(group.label)} panel">
        <div class="tools">${buttons}</div>
        <p class="group-label">${esc(group.label)}</p>
      </section>`;
  }).join('');
}

function statusHtml() {
  if (!session) {
    return `<p class="status" data-state="signed-out">Not signed in.</p>`;
  }
  if (session.denial) {
    const d = session.denial;
    return `
      <div class="status denied" data-state="denied" data-code="${esc(d.code)}" role="alert">
        <p class="deny-code">${esc(d.code)}</p>
        <p class="deny-message">${esc(d.message)}</p>
        <p class="deny-action">${esc(d.action)}</p>
        <p class="deny-retry">Next check in ${esc(d.retry_after)}s</p>
      </div>`;
  }
  const c = session.claims ?? {};
  return `
    <dl class="status granted" data-state="granted" data-role="${esc(session.role)}">
      <div><dt>Organisation</dt><dd data-field="org">${esc(c.org_name ?? '—')}</dd></div>
      <div><dt>Signed in as</dt><dd data-field="email">${esc(session.email)}</dd></div>
      <div><dt>Role</dt><dd data-field="role">${esc(session.role)}</dd></div>
      <div><dt>Licence ends</dt><dd data-field="license-end">${esc(c.license_end ?? '—')}</dd></div>
      <div><dt>Next check</dt><dd data-field="next-check">${esc(c.next_check ?? '—')}</dd></div>
      <div><dt>Scopes</dt><dd data-field="scopes">${esc(session.scopes.join(', '))}</dd></div>
    </dl>`;
}

function page() {
  // `general` is unioned in by the API on every grant. When there is no grant at
  // all — signed out — the mock shows it anyway, for the same reason the API
  // never gates it: Sign in lives there.
  const scopes = session?.scopes?.length ? session.scopes : ['general'];
  const signedIn = Boolean(session && !session.denial);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DigiBIM Hub — mock add-in</title>
<style>
  :root {
    --ink: #1b2436; --ink-2: #5a6478; --ink-3: #8a93a5;
    --rule: #dfe3ea; --paper: #f4f6f9; --card: #fff;
    --crimson: #b0202f; --slate: #4d5a70; --blue: #1f6fb8; --grey: #7c869a;
    --warn: #9a6300; --deny: #b0202f;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 "Segoe UI", system-ui, sans-serif; color: var(--ink); background: var(--paper); }
  header { background: #16203a; color: #fff; padding: 10px 16px; font-weight: 600; letter-spacing: .1em; font-size: 12px; }
  main { padding: 16px; }
  .ribbon { display: flex; gap: 0; align-items: stretch; background: var(--card); border: 1px solid var(--rule); border-radius: 6px; padding: 8px 4px; overflow-x: auto; }
  .group { display: flex; flex-direction: column; justify-content: space-between; padding: 0 12px; border-right: 1px solid var(--rule); }
  .group:last-child { border-right: 0; }
  .tools { display: flex; gap: 6px; }
  .tool { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 84px; padding: 8px 4px; background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; font: inherit; color: var(--ink); }
  .tool:hover { background: var(--paper); border-color: var(--rule); }
  .glyph { width: 34px; height: 34px; border-radius: 4px; display: block; }
  .tone-crimson { background: var(--crimson); } .tone-slate { background: var(--slate); }
  .tone-blue { background: var(--blue); } .tone-grey { background: var(--grey); }
  .tool-label { font-size: 11px; text-align: center; line-height: 1.2; }
  .group-label { margin: 8px 0 0; text-align: center; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); }
  .panel { margin-top: 16px; background: var(--card); border: 1px solid var(--rule); border-radius: 6px; padding: 14px 16px; }
  .status { margin: 0; }
  dl.status { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 20px; }
  dl.status div { min-width: 0; }
  dt { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--ink-3); }
  dd { margin: 2px 0 0; word-break: break-word; }
  .denied { border-left: 3px solid var(--deny); padding-left: 12px; }
  .deny-code { margin: 0; font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--deny); }
  .deny-message { margin: 4px 0 0; font-weight: 600; }
  .deny-action, .deny-retry { margin: 2px 0 0; color: var(--ink-2); font-size: 13px; }
  form, .actions { margin-top: 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  input { padding: 7px 9px; border: 1px solid var(--rule); border-radius: 4px; font: inherit; min-width: 260px; }
  .btn { padding: 7px 14px; border-radius: 4px; border: 1px solid var(--rule); background: var(--card); font: inherit; cursor: pointer; }
  .btn.primary { background: #16203a; color: #fff; border-color: #16203a; }
</style>
</head>
<body>
<header>DIGIBIM HUB — mock add-in</header>
<main>
  <div class="ribbon" role="toolbar" aria-label="DigiBIM Hub ribbon">
    ${ribbonHtml(scopes)}
  </div>

  <div class="panel">
    ${statusHtml()}
    ${signedIn ? `
      <div class="actions">
        <button class="btn" type="button" id="refresh">Check licence</button>
        <button class="btn" type="button" id="signout">Sign out</button>
      </div>` : `
      <form id="signin">
        <label for="email" class="visually-hidden"></label>
        <input id="email" name="email" type="email" placeholder="you@yourcompany.com"
               value="${esc(session?.email ?? '')}" aria-label="Autodesk email" required>
        <button class="btn primary" type="submit">Sign in</button>
        ${session?.denial ? `<button class="btn" type="button" id="refresh">Check licence</button>` : ''}
      </form>`}
  </div>
</main>
<script>
  const signin = document.getElementById('signin');
  if (signin) signin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const res = await fetch('/__signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    // The add-in opens the system browser here. This IS the browser, so it just
    // navigates — and the loopback redirect lands back on this same origin.
    if (data.authorize_url) window.location.href = data.authorize_url;
    else document.body.dataset.error = data.error ?? 'start failed';
  });

  const refresh = document.getElementById('refresh');
  if (refresh) refresh.addEventListener('click', async () => {
    await fetch('/__refresh', { method: 'POST' });
    window.location.href = '/';
  });

  const signout = document.getElementById('signout');
  if (signout) signout.addEventListener('click', async () => {
    await fetch('/__signout', { method: 'POST' });
    window.location.href = '/';
  });
</script>
</body>
</html>`;
}

/* ---------------------------------------------------------------- routes -- */

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

/** Store whatever the API said, grant or denial, without interpreting it. */
function record(email, body) {
  if (body.status === 'ok') {
    session = {
      email,
      role: body.role,
      scopes: body.scopes ?? [],
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      claims: claims(body.access_token),
      denial: null,
    };
    return;
  }
  session = {
    email,
    role: session?.role ?? '—',
    // A denial still leaves General on screen. The API says so too, but the
    // denied body carries no scopes at all, so the mock supplies the floor.
    scopes: ['general'],
    accessToken: null,
    // Deliberately KEPT: a denial never rotates or revokes the refresh token,
    // which is what lets a freed seat recover at the next check with no
    // re-authentication. Dropping it here would hide that.
    refreshToken: session?.refreshToken ?? null,
    claims: session?.claims ?? {},
    denial: {
      code: body.code ?? 'denied',
      message: body.message ?? '',
      action: body.action ?? '',
      retry_after: body.retry_after ?? 0,
    },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/__health') return json(res, 200, { ok: true });

  if (url.pathname === '/__state') return json(res, 200, session ?? { status: 'signed_out' });

  if (url.pathname === '/__signout' && req.method === 'POST') {
    reset();
    return json(res, 200, { ok: true });
  }

  /* Start: tell the issuer who is signing in, then ask the API for a URL. */
  if (url.pathname === '/__signin' && req.method === 'POST') {
    const { email, sub, name } = JSON.parse(await readBody(req) || '{}');
    if (!email) return json(res, 400, { error: 'email is required' });

    // Who the next /authorize will be. The add-in, not the test, opens the
    // authorize URL, so the identity has to be set out of band.
    await fetch(`${MOCK_APS}/__identity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        email_verified: true,
        sub: sub ?? `ADSK_MOCK_${createHash('sha256').update(email).digest('hex').slice(0, 8).toUpperCase()}`,
        name: name ?? email.split('@')[0],
      }),
    });

    const started = await callApi('/v1/auth/start', {
      device: deviceFor(email),
      redirectPort: PORT,
    }, email);

    if (started.status !== 200) {
      return json(res, started.status, { error: started.body?.error?.code ?? 'start_failed' });
    }
    // Remember who is mid-flight; the callback carries only a handoff.
    session = { ...(session ?? {}), email, pending: true, scopes: ['general'], denial: null, role: '—' };
    return json(res, 200, { authorize_url: started.body.authorize_url });
  }

  /* The loopback listener. This is the port passed as `redirectPort`. */
  if (url.pathname === '/callback') {
    const handoff = url.searchParams.get('handoff');
    const email = session?.email ?? '';
    if (!handoff) {
      return html(res, 400, page());
    }
    // `result=denied` still has to be exchanged: the redirect carries the
    // outcome but not the reason, and the reason is the whole point of a mock
    // that renders denials.
    const exchanged = await callApi('/v1/auth/exchange', { handoff }, email);
    record(email, exchanged.body);
    res.writeHead(302, { location: '/' });
    return res.end();
  }

  /* The daily check. Same call the add-in makes on a timer. */
  if (url.pathname === '/__refresh' && req.method === 'POST') {
    if (!session?.refreshToken) return json(res, 400, { error: 'not signed in' });
    const refreshed = await callApi('/v1/token/refresh', {
      refreshToken: session.refreshToken,
      device: deviceFor(session.email),
      daysSinceLastSuccess: 0,
    }, session.email);
    record(session.email, refreshed.body);
    return json(res, 200, session);
  }

  if (url.pathname === '/') return html(res, 200, page());

  json(res, 404, { error: 'not_found', path: url.pathname });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock add-in ribbon on http://127.0.0.1:${PORT}  (api ${API})`);
});
