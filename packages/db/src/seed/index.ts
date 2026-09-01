import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(here, '../../../../.env') });
config({ path: resolve(here, '../../../../.env.local') });

import { hash } from '@node-rs/argon2';
import { encryptAtRest } from '@app/core';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { db, pool } from '../client';
import * as s from '../schema';
import { resetToBootstrap } from './bootstrap';

/**
 * Three organisations, one per licence mode, sized so the seat rules are
 * visible without reading any code:
 *
 *   Acme       standard  — room in every role
 *   Byrne      trial     — the User role is FULL, so the next sign-in is pending
 *   DigiBIM    internal  — far-future end date, never expires
 *
 * That is the whole demo world. The previous seed built 6 orgs, 39 users, 47
 * devices and 90 days of usage to populate dashboards that no longer exist;
 * what is left is the smallest set that exercises every branch this phase has.
 */

/**
 * Publishes the local signing key so /.well-known/jwks.json has something to
 * serve. The seed truncates signing_keys, so without this the JWKS endpoint
 * returns an empty key set after every seed and no add-in can verify a token
 * offline — the entire point of ES256.
 *
 * Only the PUBLIC half is stored. `private_ref` names where the private key
 * lives (an env var locally, a KMS arn or secret name in production); the key
 * itself must never reach a database row.
 */
async function seedSigningKey(): Promise<void> {
  const kid = process.env.JWT_SIGNING_KID ?? 'k2026a';
  const privatePem = process.env.JWT_SIGNING_KEY_PEM;
  let publicPem = process.env.JWT_SIGNING_PUBLIC_PEM;

  if (!publicPem && privatePem) {
    // Deriving beats trusting a second env var to stay in sync with the first.
    publicPem = createPublicKey(createPrivateKey(privatePem))
      .export({ type: 'spki', format: 'pem' }).toString();
  }

  if (!publicPem) {
    console.log('  signing key: SKIPPED — run `pnpm keys:gen --write`, then re-seed');
    return;
  }

  await db.insert(s.signingKeys).values({
    kid,
    algorithm: 'ES256',
    publicKey: publicPem,
    privateRef: 'env:JWT_SIGNING_KEY_PEM',
    isActive: true,
  });
  console.log(`  signing key: ${kid} published to JWKS`);
}

/**
 * Dev seed. The portal owner's TOTP secret is FIXED so tests and local
 * login can generate valid codes. Never reuse this value outside local dev.
 */
export const DEV_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
export const DEV_PASSWORD = 'localdev-password';
export const DEV_OWNER_EMAIL = 'admin@yourco.local';

/**
 * One portal user per role that changes what the interface offers.
 *
 * `owner` and `admin` differ only over portal user management, which is not an
 * organisation screen — but `support` and `viewer` see the Organisations tab
 * with every mutating control removed, and that is a claim worth a test rather
 * than a reading of the capability matrix. They share the owner's password and
 * TOTP secret; nothing here is a credential anywhere but this machine.
 */
export const DEV_SUPPORT_EMAIL = 'support@yourco.local';
export const DEV_VIEWER_EMAIL = 'viewer@yourco.local';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

async function main() {
  /**
   * The first act of this script is a TRUNCATE of every table. `db:reset` and
   * `db:rebuild` are guarded by their wrapper scripts; `pnpm db:seed` runs this
   * file directly, so the guard has to live here too or it does not exist on
   * that path.
   */
  if (process.env.NODE_ENV === 'production') {
    console.error('refusing to seed: NODE_ENV=production');
    process.exit(1);
  }

  console.log('seeding…');

  // TRUNCATE plus the blocked_domains, panel_definitions and roles catalogs,
  // shared with `pnpm db:reset` so the two can never disagree about what a
  // clean database contains.
  await resetToBootstrap();

  await seedSigningKey();

  const passwordHash = await hash(DEV_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const [owner] = await db.insert(s.portalUsers).values({
    email: DEV_OWNER_EMAIL,
    displayName: 'Local Owner',
    role: 'owner',
    passwordHash,
    // Encrypted, exactly as the enrolment flow writes it. Seeding the raw
    // base32 here is what forced the API to keep a "maybe it's plaintext"
    // fallback on the read path, and a column named _enc that sometimes
    // isn't is how the original plaintext bug survived review in the first
    // place. The secret itself is still the fixed dev value, so local login
    // and tests stay deterministic.
    totpSecretEnc: encryptAtRest(DEV_TOTP_SECRET),
    totpEnabled: true,
    totpEnrolledAt: new Date(),
  }).returning();
  if (!owner) throw new Error('failed to insert owner');

  await db.insert(s.portalUsers).values([
    {
      email: DEV_SUPPORT_EMAIL,
      displayName: 'Local Support',
      role: 'support',
      passwordHash,
      totpSecretEnc: encryptAtRest(DEV_TOTP_SECRET),
      totpEnabled: true,
      totpEnrolledAt: new Date(),
    },
    {
      email: DEV_VIEWER_EMAIL,
      displayName: 'Local Viewer',
      role: 'viewer',
      passwordHash,
      totpSecretEnc: encryptAtRest(DEV_TOTP_SECRET),
      totpEnabled: true,
      totpEnrolledAt: new Date(),
    },
  ]);

  /* ------------------------------------------------ organisations ------- */

  const [acme, byrne, internal] = await db.insert(s.organizations).values([
    {
      slug: 'acme-engineering',
      name: 'Acme Engineering',
      primaryContactEmail: 'dana@acme-eng.com',
      status: 'active',
      createdBy: owner.id,
      createdAt: daysFromNow(-410),
    },
    {
      slug: 'byrne-structural',
      name: 'Byrne Structural',
      primaryContactEmail: 'ops@byrne-structural.com',
      status: 'active',
      createdBy: owner.id,
      createdAt: daysFromNow(-24),
    },
    {
      slug: 'digibim-internal',
      name: 'DigiBIM Internal',
      primaryContactEmail: 'info@digibimhub.com',
      status: 'active',
      createdBy: owner.id,
      createdAt: daysFromNow(-430),
    },
  ]).returning();
  if (!acme || !byrne || !internal) throw new Error('failed to insert organisations');

  /* ------------------------------------------------------ domains ------- */

  // One domain each. The global unique means no two orgs can share one, so
  // there is no ambiguous case left to seed.
  await db.insert(s.orgDomains).values([
    { orgId: acme.id, value: 'acme-eng.com', createdBy: owner.id },
    { orgId: byrne.id, value: 'byrne-structural.com', createdBy: owner.id },
    { orgId: internal.id, value: 'digibimhub.com', createdBy: owner.id },
  ]);

  /* ----------------------------------------------------- licences ------- */

  const [acmeLic, byrneLic, internalLic] = await db.insert(s.licenses).values([
    {
      orgId: acme.id, mode: 'standard', status: 'active',
      startDate: iso(daysFromNow(-300)), endDate: iso(daysFromNow(214)),
      graceDays: 7, createdBy: owner.id,
    },
    {
      orgId: byrne.id, mode: 'trial', status: 'active',
      startDate: iso(daysFromNow(-24)), endDate: iso(daysFromNow(6)),
      graceDays: 3, createdBy: owner.id,
    },
    {
      // Internal licences are not a commercial relationship and are not
      // allowed to expire during a demo.
      orgId: internal.id, mode: 'internal', status: 'active',
      startDate: iso(daysFromNow(-430)), endDate: '2099-12-31',
      graceDays: 30, createdBy: owner.id,
    },
  ]).returning();
  if (!acmeLic || !byrneLic || !internalLic) throw new Error('failed to insert licences');

  /**
   * Seats. Byrne's `user` seats are set to exactly the number of users seeded
   * below, so the org is at capacity the moment the seed finishes — sign a
   * fourth person in through the mock issuer and they land `pending`, which is
   * the flow the E2E asserts and the one worth clicking through by hand.
   */
  await db.insert(s.licenseRoles).values([
    { licenseId: acmeLic.id, roleKey: 'admin', seats: 2 },
    { licenseId: acmeLic.id, roleKey: 'coordinator', seats: 5 },
    { licenseId: acmeLic.id, roleKey: 'user', seats: 10 },

    { licenseId: byrneLic.id, roleKey: 'admin', seats: 1 },
    { licenseId: byrneLic.id, roleKey: 'coordinator', seats: 2 },
    { licenseId: byrneLic.id, roleKey: 'user', seats: 3 },

    { licenseId: internalLic.id, roleKey: 'admin', seats: 5 },
    { licenseId: internalLic.id, roleKey: 'coordinator', seats: 5 },
    { licenseId: internalLic.id, roleKey: 'user', seats: 25 },
  ]);

  /* -------------------------------------------------------- people ------ */

  type NewUser = typeof s.orgUsers.$inferInsert;
  const people: NewUser[] = [
    // Acme — room left in every role.
    {
      orgId: acme.id, autodeskId: 'ADSK_ACME_1', email: 'dana@acme-eng.com',
      emailVerified: true, displayName: 'Dana Whitfield', givenName: 'Dana', familyName: 'Whitfield',
      roleKey: 'admin', source: 'auto_domain',
      firstSeenAt: daysFromNow(-300), lastActivityAt: daysFromNow(0),
    },
    {
      orgId: acme.id, autodeskId: 'ADSK_ACME_2', email: 'raj@acme-eng.com',
      emailVerified: true, displayName: 'Raj Patel', givenName: 'Raj', familyName: 'Patel',
      roleKey: 'coordinator', source: 'auto_domain',
      firstSeenAt: daysFromNow(-260), lastActivityAt: daysFromNow(0),
    },
    {
      orgId: acme.id, autodeskId: 'ADSK_ACME_3', email: 'sofia@acme-eng.com',
      emailVerified: true, displayName: 'Sofia Lindqvist', givenName: 'Sofia', familyName: 'Lindqvist',
      roleKey: 'user', source: 'import', createdBy: owner.id,
      firstSeenAt: daysFromNow(-120), lastActivityAt: daysFromNow(-1),
    },
    {
      // A disabled member, so the People tab has one to render and the
      // resolver has one to deny.
      orgId: acme.id, autodeskId: 'ADSK_ACME_4', email: 'tomas@acme-eng.com',
      emailVerified: true, displayName: 'Tomas Berg', givenName: 'Tomas', familyName: 'Berg',
      roleKey: 'user', status: 'disabled', source: 'approved_request',
      firstSeenAt: daysFromNow(-200), lastActivityAt: daysFromNow(-31),
    },

    // Byrne — 3 active users against 3 user seats. Full.
    ...[1, 2, 3].map((i): NewUser => ({
      orgId: byrne.id,
      autodeskId: `ADSK_BYRNE_${i}`,
      email: `eng${i}@byrne-structural.com`,
      emailVerified: true,
      displayName: `Byrne Engineer ${i}`,
      roleKey: 'user',
      source: 'auto_domain',
      firstSeenAt: daysFromNow(-20 + i),
      lastActivityAt: daysFromNow(-i),
    })),
    {
      orgId: byrne.id, autodeskId: 'ADSK_BYRNE_ADMIN', email: 'ops@byrne-structural.com',
      emailVerified: true, displayName: 'Byrne Ops', roleKey: 'admin', source: 'auto_domain',
      firstSeenAt: daysFromNow(-24), lastActivityAt: daysFromNow(0),
    },

    // Internal.
    ...[1, 2].map((i): NewUser => ({
      orgId: internal.id,
      autodeskId: `ADSK_DBH_${i}`,
      email: `dev${i}@digibimhub.com`,
      emailVerified: true,
      displayName: `DigiBIM Dev ${i}`,
      roleKey: 'admin',
      source: 'auto_domain',
      firstSeenAt: daysFromNow(-400),
      lastActivityAt: daysFromNow(0),
    })),
  ];

  const members = await db.insert(s.orgUsers).values(people).returning();

  /* ------------------------------------------------------- devices ------ */

  const REVIT = ['2023.1', '2024.2', '2025.3', '2026.1'];
  type NewDevice = typeof s.devices.$inferInsert;
  const machines: NewDevice[] = members
    .filter((m) => m.status === 'active')
    .map((m, i): NewDevice => ({
      orgId: m.orgId,
      orgUserId: m.id,
      deviceHash: `sha256:seed-${m.id.slice(0, 8)}`,
      machineName: `BIM-WS-${String(100 + i)}`,
      revitVersions: [REVIT[i % REVIT.length]!],
      addinVersion: i % 4 === 0 ? '1.3.9' : '1.4.2',
      // One disabled machine, so the device gate has something to deny.
      status: i === 2 ? 'disabled' : 'active',
      firstSeenAt: m.firstSeenAt,
      lastSeenAt: daysFromNow(0),
    }));

  await db.insert(s.devices).values(machines);

  /* -------------------------------------------------------- report ------ */

  const byrneUsers = members.filter((m) => m.orgId === byrne.id && m.roleKey === 'user').length;

  console.log(`
  portal owner   ${DEV_OWNER_EMAIL} / ${DEV_PASSWORD}
  portal support ${DEV_SUPPORT_EMAIL} / ${DEV_PASSWORD}
  portal viewer  ${DEV_VIEWER_EMAIL} / ${DEV_PASSWORD}
  organisations  3 (standard, trial, internal)
  people         ${members.length} across 3 organisations
  devices        ${machines.length}

  Byrne Structural is at capacity: ${byrneUsers}/3 user seats taken.
  The next person to sign in on @byrne-structural.com lands as pending.
`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
