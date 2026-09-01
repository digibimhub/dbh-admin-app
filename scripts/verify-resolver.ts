/**
 * Integration check for resolveUser against the REAL seeded database.
 *
 * The unit tests in packages/core cover the decision logic with injected
 * fakes. They cannot catch a wrong WHERE clause, a citext comparison that
 * turns out to be case-sensitive, or an upsert whose conflict target does not
 * match the unique index. That is what this exercises: the same function,
 * wired to Postgres through the API's own dbResolveDeps.
 *
 * Everything runs inside a transaction that is ALWAYS rolled back, so it can
 * be re-run against a seeded database without dirtying it.
 *
 *   pnpm verify:resolver
 */
import 'dotenv/config';
import { and, count, eq } from 'drizzle-orm';
import { db, pool, schema as s } from '@app/db';
import { resolveUser, type AutodeskIdentity, type DeviceInfo } from '@app/core';
import { dbResolveDeps } from '../apps/api/src/lib/resolve-deps.ts';

const dev = (hash: string): DeviceInfo => ({
  deviceHash: hash,
  machineName: 'VERIFY-WS',
  revitVersion: '2026.1',
  addinVersion: '1.4.2',
});

const who = (
  over: Partial<AutodeskIdentity> & { autodeskId: string; email: string },
): AutodeskIdentity => ({ emailVerified: true, displayName: 'Verify User', ...over });

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (ok) passed++;
  else failed++;
}

/** Thrown to force the transaction to roll back once the checks are done. */
class Rollback extends Error {}

// Wrapped in main() rather than using top-level await: the root package.json
// has no "type": "module", so tsx compiles files under scripts/ as CommonJS.
async function main(): Promise<void> {
  await db
  .transaction(async (tx) => {
    const deps = dbResolveDeps(tx);
    const run = (i: AutodeskIdentity, d: DeviceInfo) => resolveUser(i, d, deps);

    /* ---- fixtures picked by property, never by hardcoded id ---- */

    const [defaultRole] = await tx.select().from(s.roles).where(eq(s.roles.isDefault, true)).limit(1);
    if (!defaultRole) throw new Error('seed has no default role');

    const [activeUser] = await tx.select().from(s.orgUsers)
      .where(eq(s.orgUsers.status, 'active')).limit(1);
    const [disabledUser] = await tx.select().from(s.orgUsers)
      .where(eq(s.orgUsers.status, 'disabled')).limit(1);
    if (!activeUser || !disabledUser) throw new Error('seed is missing an active or disabled member');

    const [domain] = await tx.select().from(s.orgDomains)
      .where(eq(s.orgDomains.orgId, activeUser.orgId)).limit(1);
    if (!domain) throw new Error('seed member has no domain on their org');

    const [device] = await tx.select().from(s.devices)
      .where(eq(s.devices.orgUserId, activeUser.id)).limit(1);
    const [disabledDevice] = await tx.select().from(s.devices)
      .where(eq(s.devices.status, 'disabled')).limit(1);

    console.log('\nresolveUser against the seeded database\n');

    /* ---- tier 1: known user ---- */

    const known = await run(
      who({ autodeskId: activeUser.autodeskId!, email: activeUser.email! }),
      dev(device?.deviceHash ?? 'sha256:verify-unknown'),
    );
    check('known autodesk_id resolves', known.ok, known.ok ? '' : known.code);
    check('resolves to their own organisation',
      known.ok && known.orgId === activeUser.orgId);
    check('tier 1, no provisioning', known.ok && known.tier === 1 && known.source === 'existing');

    /**
     * citext is the whole reason this check exists: a case-sensitive column
     * would resolve the seeded address and silently fail the shouted one, and
     * only against a real database does the difference show up.
     */
    const shouted = await run(
      who({ autodeskId: 'ADSK_VERIFY_CASE', email: activeUser.email!.toUpperCase() }),
      dev('sha256:verify-case'),
    );
    check('email match is case-insensitive (citext)',
      shouted.ok && shouted.userId === activeUser.id,
      shouted.ok ? '' : shouted.code);

    /* ---- scopes ---- */

    if (known.ok) {
      const [role] = await tx.select().from(s.roles).where(eq(s.roles.key, activeUser.roleKey)).limit(1);
      const neverGated = await tx.select({ slug: s.panelDefinitions.slug })
        .from(s.panelDefinitions).where(eq(s.panelDefinitions.neverGated, true));

      check('scopes are non-empty', known.scopes.length > 0);
      check('every never-gated slug is granted',
        neverGated.every((n) => known.scopes.includes(n.slug)),
        `granted: ${known.scopes.join(',')}`);
      check('role scopes are a subset of what was granted',
        (role?.scopes ?? []).every((x) => known.scopes.includes(x)));
      check('token carries the role KEY, not its name',
        known.roleKey === activeUser.roleKey && known.roleKey !== role?.name);
    }

    /* ---- gates ---- */

    const disabled = await run(
      who({ autodeskId: disabledUser.autodeskId!, email: disabledUser.email! }),
      dev('sha256:verify-disabled'),
    );
    check('a disabled member is denied', !disabled.ok && disabled.code === 'user_disabled',
      disabled.ok ? 'allowed' : disabled.code);

    if (disabledDevice) {
      const [owner] = await tx.select().from(s.orgUsers)
        .where(and(eq(s.orgUsers.orgId, disabledDevice.orgId), eq(s.orgUsers.status, 'active')))
        .limit(1);
      if (owner) {
        const onBadMachine = await run(
          who({ autodeskId: owner.autodeskId!, email: owner.email! }),
          dev(disabledDevice.deviceHash),
        );
        check('a disabled device is denied',
          !onBadMachine.ok && onBadMachine.code === 'device_disabled',
          onBadMachine.ok ? 'allowed' : onBadMachine.code);
      }
    }

    /* ---- tier 2: domain, and the global unique ---- */

    const unknownDomain = await run(
      who({ autodeskId: 'ADSK_VERIFY_NOWHERE', email: 'nobody@definitely-not-registered.test' }),
      dev('sha256:verify-nowhere'),
    );
    check('an unregistered domain is denied',
      !unknownDomain.ok && unknownDomain.code === 'domain_not_registered',
      unknownDomain.ok ? 'allowed' : unknownDomain.code);

    const unverified = await run(
      who({ autodeskId: 'ADSK_VERIFY_UNVERIFIED', email: `nobody@${domain.value}`, emailVerified: false }),
      dev('sha256:verify-unverified'),
    );
    check('an unverified email never reaches the domain lookup',
      !unverified.ok && unverified.code === 'email_not_verified',
      unverified.ok ? 'allowed' : unverified.code);

    /**
     * The invariant the schema now enforces. Before the global unique this was
     * the `multiple_orgs` case; the check is inverted — it is no longer
     * possible for a domain to name two organisations.
     */
    const dupes = await tx.select({ value: s.orgDomains.value, n: count() })
      .from(s.orgDomains).groupBy(s.orgDomains.value);
    check('no domain is claimed by more than one organisation',
      dupes.every((d) => d.n === 1),
      dupes.filter((d) => d.n > 1).map((d) => d.value).join(', '));

    /* ---- seats ---- */

    const [full] = await tx.select({
      orgId: s.licenses.orgId,
      licenseId: s.licenses.id,
      roleKey: s.licenseRoles.roleKey,
      seats: s.licenseRoles.seats,
    })
      .from(s.licenseRoles)
      .innerJoin(s.licenses, eq(s.licenses.id, s.licenseRoles.licenseId))
      .where(eq(s.licenses.status, 'active'))
      .orderBy(s.licenseRoles.seats)
      .limit(1);

    if (full) {
      const used = await deps.countActiveInRole(full.orgId, full.roleKey);
      const seatRow = await deps.getSeats(full.licenseId, full.roleKey);
      check('seat occupancy is countable and matches the licence row',
        typeof used === 'number' && seatRow?.seats === full.seats,
        `${used}/${seatRow?.seats}`);
    }

    /**
     * The seat rule end to end, on the org the seed deliberately leaves full.
     * A new person on its domain must become a member — right org, default
     * role — and be denied, rather than being refused outright.
     */
    const [byrne] = await tx.select().from(s.organizations)
      .where(eq(s.organizations.slug, 'byrne-structural')).limit(1);
    if (byrne) {
      const [byrneDomain] = await tx.select().from(s.orgDomains)
        .where(eq(s.orgDomains.orgId, byrne.id)).limit(1);
      const before = await deps.countActiveInRole(byrne.id, defaultRole.key);

      const overflow = await run(
        who({ autodeskId: 'ADSK_VERIFY_OVERFLOW', email: `overflow@${byrneDomain!.value}` }),
        dev('sha256:verify-overflow'),
      );
      check('a full role denies with seats_exhausted',
        !overflow.ok && overflow.code === 'seats_exhausted',
        overflow.ok ? 'allowed' : overflow.code);

      const [created] = await tx.select().from(s.orgUsers)
        .where(eq(s.orgUsers.autodeskId, 'ADSK_VERIFY_OVERFLOW')).limit(1);
      check('they are still made a member, pending',
        created?.status === 'pending' && created?.orgId === byrne.id,
        created ? `${created.status} in ${created.orgId}` : 'no row created');
      check('a pending member does not consume a seat',
        (await deps.countActiveInRole(byrne.id, defaultRole.key)) === before);
    }

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    // Always roll back: this ran against the developer's seeded database.
    throw new Rollback();
  })
  .catch((e: unknown) => {
    if (!(e instanceof Rollback)) throw e;
  });

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
