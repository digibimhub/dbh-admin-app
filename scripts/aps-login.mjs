/**
 * Drives the full Autodesk sign-in exactly as the add-in will, without .NET.
 *
 * The add-in's job in this flow is small and entirely non-secret: ask the
 * server to start, open the system browser, listen on a loopback port, hand
 * the resulting code back. This script does those four things, so the whole
 * server side — PKCE, the APS code exchange, userinfo, resolveUser, device
 * and usage recording, token signing — is exercised before any C# exists.
 *
 * It then calls /v1/token/refresh with the refresh token it received, because
 * that is the endpoint every workstation hits daily and the one most likely
 * to break unnoticed.
 *
 *   pnpm aps:login
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

const API = process.env.SMOKE_API ?? 'http://localhost:3001';
const PORT = Number(process.env.APS_REDIRECT_PORT ?? 51234);
const OPEN_BROWSER = !process.argv.includes('--no-open');

/** Stable per-machine in reality; random here so repeat runs look like new devices. */
const DEVICE = {
  deviceHash: `sha256:manual-${randomBytes(12).toString('hex')}`,
  machineName: 'MANUAL-VALIDATION',
  osVersion: 'Windows 11',
  revitVersion: '2026.1',
  addinVersion: '0.0.0-manual',
};

const line = (s = '') => console.log(s);
/**
 * Ends the run with a message.
 *
 * It throws rather than calling process.exit, and that is not a style choice.
 * Calling process.exit() while an undici connection from fetch is still open
 * tears Node down mid-flight with "Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)" and exit code 127 — so a run that did everything right
 * reports a crash. Narrowed to exactly that: an http server, one fetch, and
 * exit(). Remove any of the three and it is clean; set exitCode instead of
 * calling exit() and it is clean with all three.
 */
class Fatal extends Error {}

const fail = (msg, extra) => {
  console.error(`\n✗ ${msg}`);
  if (extra) console.error(extra);
  throw new Fatal(msg);
};

/** Ends the run without an error — a denial is the system working. */
class Done extends Error {}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* leave undefined */ }
  return { status: res.status, json, text };
}

/** Decodes a JWT payload for display. Does NOT verify — the add-in does that. */
function decodeJwt(token) {
  const part = token.split('.')[1];
  if (!part) return null;
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

const CHROME_PATHS = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
];

/**
 * Opens the sign-in page, preferring Chrome over the system default.
 *
 * Which browser this lands in matters more than it looks: Autodesk sessions
 * are per-browser, so a flow that opens in whichever browser Windows happens
 * to default to will sometimes ask for credentials and sometimes not, and the
 * account you end up signed in as decides whether resolveUser grants or
 * queues. Pinning it makes repeat runs reproducible.
 *
 * Override with APS_BROWSER=<path to exe>, or --no-open to open nothing.
 */
function openBrowser(url) {
  const explicit = process.env.APS_BROWSER;
  const exe = explicit ?? CHROME_PATHS.find((p) => p && existsSync(p));

  if (exe && existsSync(exe)) {
    line(`(opening ${exe.split('\\').pop()})`);
    spawn(exe, [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (explicit) line(`APS_BROWSER=${explicit} not found — falling back to the system default`);

  // `start` is a cmd builtin, hence the shell. The empty "" is the window
  // title argument — without it a quoted URL becomes the title and nothing opens.
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * Waits for Autodesk's redirect to reach our loopback listener.
 *
 * Teardown order matters here. Closing the server from inside the request
 * handler leaves the keep-alive socket the browser is still holding, and the
 * process then exits with that handle mid-close — which trips a libuv
 * assertion on Windows ("!(handle->flags & UV_HANDLE_CLOSING)") and reports
 * exit code 127 after a run that did everything correctly. So: flush the
 * response, drop every connection, close the listener, and only then settle.
 */
function awaitCallback() {
  return new Promise((resolve, reject) => {
    let outcome = null;   // set by the handler
    let flushed = false;  // set by res.end's callback
    let done = false;

    const teardown = () => {
      // Both halves must have happened: an outcome to settle with, and a
      // response the browser has actually received.
      if (done || !outcome || !flushed) return;
      done = true;
      clearTimeout(timer);
      server.closeAllConnections?.();
      server.close(() => outcome());
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (!url.pathname.startsWith('/callback')) { res.writeHead(404).end(); return; }

      const result = url.searchParams.get('result');
      const handoff = url.searchParams.get('handoff');
      const code = url.searchParams.get('code');
      const ok = result === 'ok' && handoff;

      outcome = ok
        ? () => resolve({ handoff })
        : () => reject(new Error(`callback returned result=${result} code=${code ?? 'none'}`));

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8">
<title>${ok ? 'Signed in' : 'Sign-in failed'}</title>
<body style="font:16px system-ui;padding:3rem;max-width:34rem;margin:auto">
<h1 style="font-size:1.25rem">${ok ? 'Signed in.' : 'Sign-in was refused.'}</h1>
<p>${ok ? 'You can close this tab and return to the terminal.'
        : `The server reported <code>${code ?? result ?? 'an unknown result'}</code>. The terminal has the detail.`}</p>
</body>`, () => { flushed = true; teardown(); });

      teardown();
    });

    server.on('error', (e) => reject(
      e.code === 'EADDRINUSE'
        ? new Error(`port ${PORT} is already in use — set APS_REDIRECT_PORT to a free one`)
        : e));
    server.listen(PORT, '127.0.0.1');

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      server.closeAllConnections?.();
      server.close(() => reject(new Error('timed out after 5 minutes waiting for the browser')));
    }, 5 * 60 * 1000);
    timer.unref();
  });
}

async function main() {
  line(`api: ${API}`);
  line(`device: ${DEVICE.deviceHash}`);

  /* ---- 1. start ---- */
  const start = await post('/v1/auth/start', { device: DEVICE, redirectPort: PORT });
  if (start.status === 503) fail('APS is not configured — set APS_CLIENT_ID and APS_CLIENT_SECRET in .env');
  if (start.status !== 200 || !start.json?.authorize_url) fail(`/v1/auth/start returned ${start.status}`, start.text);

  const authorizeUrl = start.json.authorize_url;
  const u = new URL(authorizeUrl);
  line('\nauthorize url parameters');
  for (const k of ['client_id', 'redirect_uri', 'scope', 'code_challenge_method', 'response_type']) {
    line(`  ${k.padEnd(22)} ${u.searchParams.get(k)}`);
  }

  /* ---- 2. browser ---- */
  line('\nOpen this in a browser if it does not open by itself:\n');
  line(authorizeUrl);
  if (OPEN_BROWSER) openBrowser(authorizeUrl);
  line('\nwaiting for the redirect…');

  const { handoff } = await awaitCallback();
  line('callback received');

  /* ---- 3. exchange ---- */
  const ex = await post('/v1/auth/exchange', { handoff });
  if (ex.status !== 200) fail(`/v1/auth/exchange returned ${ex.status}`, ex.text);

  if (ex.json.status === 'denied') {
    line(`\nDENIED: ${ex.json.code}`);
    line(`  ${ex.json.message}`);
    if (ex.json.action) line(`  ${ex.json.action}`);
    line('\nThis is the system working, not failing. An account whose email domain no');
    line('org lists is meant to land in the Access Requests queue. Approve it at');
    line('http://localhost:3000/requests and run this again.');
    throw new Done();
  }

  const claims = decodeJwt(ex.json.access_token);
  line('\nGRANTED');
  line(`  org        ${claims.org_name}`);
  line(`  email      ${claims.email}`);
  line(`  role       ${claims.role}`);
  line(`  panels     ${JSON.stringify(claims.panels)}`);
  line(`  features   ${JSON.stringify(claims.features)}`);
  line(`  licence to ${claims.license_end}  (grace ${claims.grace_days}d)`);
  line(`  next check ${claims.next_check}`);
  line(`  kid        ${decodeJwt(ex.json.access_token) && JSON.parse(Buffer.from(ex.json.access_token.split('.')[0], 'base64').toString()).kid}`);

  /* ---- 4. the daily path ---- */
  line('\nre-validating through /v1/token/refresh (the daily heartbeat)…');
  const rf = await post('/v1/token/refresh', {
    refreshToken: ex.json.refresh_token,
    device: DEVICE,
    daysSinceLastSuccess: 0,
  });
  if (rf.status !== 200) fail(`/v1/token/refresh returned ${rf.status}`, rf.text);
  if (rf.json.status === 'denied') fail(`refresh denied: ${rf.json.code} — ${rf.json.message}`);

  const rotated = rf.json.refresh_token !== ex.json.refresh_token;
  line(`  refresh token rotated: ${rotated ? 'yes' : 'NO — it should rotate on every grant'}`);
  line(`  fresh access token:    ${rf.json.access_token ? 'yes' : 'NO'}`);

  // The old refresh token must be dead the moment a new one is issued, or a
  // stolen copy stays valid forever and rotation buys nothing.
  const replay = await post('/v1/token/refresh', {
    refreshToken: ex.json.refresh_token, device: DEVICE, daysSinceLastSuccess: 0,
  });
  const replayRejected = replay.json?.status === 'denied';
  line(`  old token now invalid: ${replayRejected ? 'yes' : 'NO — rotation is not invalidating the previous token'}`);

  line('\nDone. The device and today\'s usage row are now in the database:');
  line('  http://localhost:3000/devices');
  // exitCode, not exit(): the latter kills the process while sockets from the
  // loopback listener may still be closing, which is the same libuv assertion.
  process.exitCode = rotated && replayRejected ? 0 : 1;
}

main().catch((e) => {
  // Fatal has already printed itself; Done is a clean stop; anything else is
  // an unexpected throw and still needs reporting.
  if (e instanceof Done) return;
  if (!(e instanceof Fatal)) console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
});
