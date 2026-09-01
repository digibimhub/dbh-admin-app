import { generateEs256Pair, publicPemFromPrivatePem, buildJwks } from '@app/core';
import { db, schema as s } from '@app/db';
import { eq } from 'drizzle-orm';
import { env } from '../env';

export interface SigningKey {
  kid: string;
  privatePem: string;
  publicPem: string;
}

let cached: SigningKey | null = null;

/**
 * dotenv already turns a double-quoted `\n` PEM into real newlines, so this
 * is a no-op on a well-formed value. It only rescues a key written unquoted
 * with literal backslash-n, which `createPrivateKey` would otherwise reject
 * at boot with an opaque message.
 */
function normalisePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

export async function getSigningKey(): Promise<SigningKey> {
  if (cached) return cached;

  if (env.jwtSigningKeyPem) {
    const privatePem = normalisePem(env.jwtSigningKeyPem);
    // Derive rather than trust JWT_SIGNING_PUBLIC_PEM: if the two ever drift
    // apart we would publish a JWKS that fails to verify every token we
    // issue, and the failure would only show up on add-ins in the field.
    const publicPem = publicPemFromPrivatePem(privatePem);

    // JWT_SIGNING_PUBLIC_PEM is not used to sign or verify anything — it is
    // here so a copy/paste error that pairs two different keys is caught at
    // boot rather than by an add-in in the field failing to verify tokens.
    if (env.jwtSigningPublicPem) {
      const declared = normalisePem(env.jwtSigningPublicPem).replace(/\s+/g, '');
      if (declared !== publicPem.replace(/\s+/g, '')) {
        throw new Error('JWT_SIGNING_PUBLIC_PEM does not match JWT_SIGNING_KEY_PEM');
      }
    }

    cached = { kid: env.jwtSigningKid, privatePem, publicPem };

    // Publish it so /.well-known/jwks.json has real key material to serve.
    await db.insert(s.signingKeys).values({
      kid: env.jwtSigningKid,
      publicKey: publicPem,
      privateRef: 'env:JWT_SIGNING_KEY_PEM',
      algorithm: 'ES256',
      isActive: true,
    }).onConflictDoUpdate({
      target: s.signingKeys.kid,
      set: { publicKey: publicPem, isActive: true },
    });
    return cached;
  }

  if (!env.isDev) throw new Error('JWT_SIGNING_KEY_PEM is required in production');

  const pair = generateEs256Pair();
  await db.insert(s.signingKeys).values({
    kid: env.jwtSigningKid,
    publicKey: pair.publicPem,
    privateRef: 'memory:local-dev',
    algorithm: 'ES256',
    isActive: true,
  }).onConflictDoUpdate({
    target: s.signingKeys.kid,
    set: { publicKey: pair.publicPem, isActive: true },
  });
  cached = { kid: env.jwtSigningKid, privatePem: pair.privatePem, publicPem: pair.publicPem };
  console.warn('Generated an ephemeral ES256 signing key for local dev. Set JWT_SIGNING_KEY_PEM to persist across restarts.');
  return cached;
}

export interface PublicKeyRow { kid: string; publicPem: string }

/** Every key an add-in might legitimately have signed against. */
export async function listPublicKeys(): Promise<PublicKeyRow[]> {
  const local = await getSigningKey();
  const rows = await db.select().from(s.signingKeys).where(eq(s.signingKeys.isActive, true));
  const out = rows.map((r) => ({ kid: r.kid, publicPem: r.publicKey }));
  if (!out.some((k) => k.kid === local.kid)) {
    out.push({ kid: local.kid, publicPem: local.publicPem });
  }
  return out;
}

/**
 * Body of GET /.well-known/jwks.json.
 *
 * This used to emit `{kty, kid, use, alg}` with no curve point, which is
 * syntactically valid JWKS and cryptographically useless — an add-in that
 * fetched it could never verify a token offline, which is the entire reason
 * the endpoint exists.
 */
export async function jwks(): Promise<{ keys: unknown[] }> {
  return buildJwks(await listPublicKeys());
}

/** Public PEM for a specific kid, for verifying an add-in access token. */
export async function publicKeyForKid(kid: string | undefined): Promise<string | null> {
  const keys = await listPublicKeys();
  if (!kid) return keys[0]?.publicPem ?? null;
  return keys.find((k) => k.kid === kid)?.publicPem ?? null;
}
