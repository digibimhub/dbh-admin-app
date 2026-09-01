import {
  SignJWT, jwtVerify, importPKCS8, importSPKI, exportJWK, decodeProtectedHeader,
  type JWK, type JWTPayload,
} from 'jose';
import { addinTokenClaims, type AddinTokenClaims } from '@app/shared';

export interface PortalClaims extends JWTPayload {
  sub: string;
  role: 'owner' | 'admin' | 'support' | 'viewer';
  epoch: number;
  typ: 'session' | 'enrol';
  last_reauth_at?: number;
  pending_secret?: string;
}

const encoder = new TextEncoder();

/**
 * HS256 needs a key with at least as much entropy as the digest, or the
 * signature is brute-forceable offline from any single captured session
 * cookie. 32 characters is the floor; the deploy checklist generates 32 random
 * bytes.
 */
const MIN_PORTAL_SECRET_LEN = 32;

function portalSecret(): Uint8Array {
  const s = process.env.JWT_PORTAL_SECRET;
  if (!s) throw new Error('JWT_PORTAL_SECRET is not set');
  if (s.length < MIN_PORTAL_SECRET_LEN) {
    throw new Error(`JWT_PORTAL_SECRET must be at least ${MIN_PORTAL_SECRET_LEN} characters`);
  }
  return encoder.encode(s);
}

export async function signPortalJwt(claims: Omit<PortalClaims, 'iat' | 'exp'>, ttlSec = 8 * 3600): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(portalSecret());
}

export async function verifyPortalJwt(token: string): Promise<PortalClaims> {
  // Pinning `algorithms` is what stops an attacker swapping the header to
  // 'none', or to ES256 verified against the public signing key.
  const { payload } = await jwtVerify(token, portalSecret(), { algorithms: ['HS256'] });
  if (!payload.sub || typeof payload.epoch !== 'number' || !payload.role || !payload.typ) {
    throw new Error('invalid portal claims');
  }
  return payload as PortalClaims;
}

export async function signAddinJwt(input: {
  privatePem: string;
  kid: string;
  issuer: string;
  claims: Omit<AddinTokenClaims, 'iss' | 'exp'>;
  ttlSec?: number;
}): Promise<string> {
  const key = await importPKCS8(input.privatePem, 'ES256');
  const ttl = input.ttlSec ?? 86400;
  // `kid` goes in the protected header, per doc 04: the add-in ships two or
  // three public keys and picks by kid, so a key can be rotated without a new
  // DLL reaching every workstation first.
  return new SignJWT({ ...input.claims })
    .setProtectedHeader({ alg: 'ES256', kid: input.kid })
    .setIssuer(input.issuer)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(key);
}

export async function verifyAddinJwt(token: string, publicPem: string, issuer: string): Promise<AddinTokenClaims> {
  const key = await importSPKI(publicPem, 'ES256');
  const { payload } = await jwtVerify(token, key, { algorithms: ['ES256'], issuer });
  return addinTokenClaims.parse(payload);
}

/**
 * Read `kid` from the protected header so a verifier can choose which public
 * key to try. The header is unauthenticated until the signature checks out —
 * use this ONLY to select a key, never to make a decision.
 */
export function addinTokenKid(token: string): string | undefined {
  return decodeProtectedHeader(token).kid;
}

/** One JWKS entry. jose's exportJWK keeps this free of DOM types: this
 *  package targets Node only, so pulling in lib.dom for CryptoKey would
 *  wrongly declare browser globals across the whole package. */
export async function publicJwkFromPem(
  kid: string,
  publicPem: string,
): Promise<JWK & { kid: string; use: string; alg: string }> {
  const key = await importSPKI(publicPem, 'ES256', { extractable: true });
  const jwk = await exportJWK(key);
  return { ...jwk, kid, use: 'sig', alg: 'ES256' };
}

/**
 * The body of `GET /.well-known/jwks.json`.
 *
 * Every entry must carry real key material (`crv`, `x`, `y`) — a JWKS listing
 * only `kty`/`kid` is syntactically fine and cryptographically useless, and an
 * add-in that fetches one cannot verify anything offline.
 */
export async function buildJwks(
  keys: Array<{ kid: string; publicPem: string }>,
): Promise<{ keys: Array<JWK & { kid: string; use: string; alg: string }> }> {
  return {
    keys: await Promise.all(keys.map((k) => publicJwkFromPem(k.kid, k.publicPem))),
  };
}
