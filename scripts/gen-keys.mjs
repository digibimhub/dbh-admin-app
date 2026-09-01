/**
 * Generates the ES256 keypair the add-in token is signed with.
 *
 * The PUBLIC half is what add-ins verify against — it is served from
 * /.well-known/jwks.json and compiled into the DLL as a fallback. The PRIVATE
 * half signs, lives only in the API's environment, and must never be
 * committed. `kid` is carried in the JWT header so a key can be rotated
 * without shipping a new DLL: publish the new public key in JWKS, start
 * signing with the new kid, retire the old one once tokens have expired.
 *
 *   node scripts/gen-keys.mjs              # print PEMs
 *   node scripts/gen-keys.mjs --write      # also write them into .env
 */
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',                                  // P-256 == ES256
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const year = new Date().getFullYear();
const kid = `k${year}a`;

console.log('--- PUBLIC KEY (safe to publish, goes in signing_keys.public_key) ---');
console.log(publicKey);
console.log('--- KID ---');
console.log(kid, '\n');

if (!process.argv.includes('--write')) {
  console.log('--- PRIVATE KEY (secret) ---');
  console.log(privateKey);
  console.log('Re-run with --write to put these into .env automatically.');
  process.exit(0);
}

const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) throw new Error('.env not found — copy .env.example first');
let env = fs.readFileSync(envPath, 'utf8');
const crlf = env.includes('\r\n');
if (crlf) env = env.replace(/\r\n/g, '\n');

// PEMs are multi-line; store with literal \n so the value stays one .env line.
const set = (key, value) => {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, line) : `${env.replace(/\n*$/, '\n')}${line}\n`;
};

set('JWT_SIGNING_KEY_PEM', JSON.stringify(privateKey));
set('JWT_SIGNING_PUBLIC_PEM', JSON.stringify(publicKey));
set('JWT_SIGNING_KID', kid);

// A 32-byte AES-256-GCM key for encrypting TOTP secrets and APS tokens at rest.
if (/^ENCRYPTION_KEY=\s*$/m.test(env)) {
  const { randomBytes } = await import('node:crypto');
  set('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  console.log('ENCRYPTION_KEY was empty — generated one.');
}

if (crlf) env = env.replace(/\n/g, '\r\n');
fs.writeFileSync(envPath, env);
console.log(`wrote JWT_SIGNING_KEY_PEM, JWT_SIGNING_PUBLIC_PEM and JWT_SIGNING_KID=${kid} to .env`);
console.log('.env is gitignored — never commit the private key.');
