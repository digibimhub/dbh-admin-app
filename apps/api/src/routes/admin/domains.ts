import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { createDomainSchema, reasonSchema } from '@app/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { uuidParam } from '../../lib/params';
import { audit } from '../../middleware/audit';
import { requireCapability } from '../../middleware/auth';

export const domains = new Hono();

domains.get('/orgs/:id/domains', async (c) => {
  const id = uuidParam(c);
  const rows = await db.select().from(s.orgDomains)
    .where(eq(s.orgDomains.orgId, id))
    .orderBy(asc(s.orgDomains.value));
  return c.json({ rows });
});

/**
 * Register a domain.
 *
 * A domain is now a hostname and nothing else — no kind, no label, no
 * subdomain flag, and no DNS verification step. Verification was decorative:
 * `is_active` defaulted to true and the create route never set it, so a domain
 * was live for auto-provisioning the moment it was added, whatever the
 * verification screen said.
 *
 * The value is globally unique, so a domain either belongs to this
 * organisation or to exactly one other, and there is no third case.
 */
domains.post('/orgs/:id/domains', requireCapability('domain.manage'), async (c) => {
  const id = uuidParam(c);
  const body = createDomainSchema.parse(await c.req.json());
  const value = body.value.trim().toLowerCase();
  const user = c.get('portalUser');

  const [org] = await db.select().from(s.organizations)
    .where(eq(s.organizations.id, id)).limit(1);
  if (!org) throw notFound('Organisation not found');

  // A free mailbox domain would let the first person with a gmail address
  // auto-provision every other gmail user into this organisation.
  const [blocked] = await db.select().from(s.blockedDomains)
    .where(eq(s.blockedDomains.value, value)).limit(1);
  if (blocked) {
    throw badRequest(
      `${value} is a public mailbox domain. Anyone could claim an address on it, so it cannot map to an organisation.`,
    );
  }

  // Checked before the insert so the message can name the holder. The unique
  // index below is still the authority — this is a nicer error, not the guard.
  const [taken] = await db
    .select({ orgName: s.organizations.name, orgId: s.organizations.id })
    .from(s.orgDomains)
    .innerJoin(s.organizations, eq(s.organizations.id, s.orgDomains.orgId))
    .where(eq(s.orgDomains.value, value))
    .limit(1);
  if (taken) {
    throw conflict(
      taken.orgId === id
        ? `${value} is already registered to this organisation.`
        : `${value} is already registered to ${taken.orgName}. A domain maps to one organisation, so it must be removed there first.`,
    );
  }

  try {
    const [row] = await db.insert(s.orgDomains)
      .values({ orgId: id, value, createdBy: user.id })
      .returning();

    await audit(c, {
      orgId: id,
      action: 'domain.create',
      targetType: 'org_domain',
      targetId: row!.id,
      after: row,
    });
    return c.json({ row }, 201);
  } catch (e: unknown) {
    // Lost the race between the check above and the insert.
    if (String(e).includes('unique') || String(e).includes('duplicate')) {
      throw conflict(`${value} was registered to another organisation a moment ago.`);
    }
    throw e;
  }
});

/**
 * Removing a domain stops auto-provisioning for everyone on it, so it takes a
 * reason for the same reason a suspension does.
 */
domains.delete('/domains/:id', requireCapability('domain.manage'), async (c) => {
  const id = uuidParam(c);
  const { reason } = reasonSchema.parse(await c.req.json().catch(() => ({})));

  const [before] = await db.select().from(s.orgDomains)
    .where(eq(s.orgDomains.id, id)).limit(1);
  if (!before) throw notFound();

  await db.delete(s.orgDomains).where(eq(s.orgDomains.id, id));

  await audit(c, {
    orgId: before.orgId,
    action: 'domain.delete',
    targetType: 'org_domain',
    targetId: id,
    before,
    after: { reason },
  });
  return c.json({ ok: true });
});
