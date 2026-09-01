/**
 * Prints the current TOTP code for the seeded dev portal owner.
 *
 * `pnpm totp` does the same thing through the workspace, but this one is plain
 * Node with no dependencies and no pnpm, so it works in any shell — including
 * one whose PATH predates the toolchain install.
 *
 *   node scripts/totp.mjs           print the code once
 *   node scripts/totp.mjs --watch   reprint as each 30s window turns over
 *
 * The secret is the fixed local-dev value from the seed. It is a well-known
 * RFC test vector and must never be used outside local development.
 */
import { createHmac } from 'node:crypto';

const SECRET = process.env.TOTP_SECRET ?? 'JBSWY3DPEHPK3PXP';

function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = A.indexOf(ch);
    if (i < 0) throw new Error(`bad base32 character: ${ch}`);
    bits += i.toString(2).padStart(5, '0');
  }
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

/** RFC 6238: SHA-1, 30-second step, 6 digits. */
function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

const secondsLeft = () => 30 - (Math.floor(Date.now() / 1000) % 30);

function show() {
  const left = secondsLeft();
  console.log(`\n  ${totp(SECRET)}    valid for ${left}s`);
  // Under ~5s the code will very likely expire mid-typing, and the login will
  // look like a wrong password rather than a stale code.
  if (left <= 5) console.log('  (about to roll over — wait for the next one)');
}

show();

if (process.argv.includes('--watch')) {
  console.log('\nwatching — Ctrl+C to stop');
  let last = Math.floor(Date.now() / 1000 / 30);
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000 / 30);
    if (now !== last) { last = now; show(); }
  }, 500);
} else {
  console.log('\n  login: http://localhost:3000');
  console.log('  email: admin@yourco.local');
  console.log('  pass:  localdev-password');
  console.log('\n  re-run for a fresh code, or use --watch to keep printing them');
}
