import { and, count, eq, inArray } from 'drizzle-orm';
import { schema as s } from '@app/db';
import type { DbConn } from '../lib/db';
import type { JobResult } from './lock';
import { postWebhook } from '../lib/notify';
import { sendMail } from '../lib/mailer';
import { env } from '../env';

/** Organisations listed individually before the tail is summarised as a count. */
const MAX_ORGS = 15;

const LABEL = {
  awaiting_approval: 'awaiting approval',
  seats_exhausted: 'no seat free',
  no_licence: 'no licence yet',
} as const;

/**
 * Daily "somebody is waiting" digest for the organisation join queues.
 *
 * The sibling of `pendingRequestsDigest`, for the people who DID match an
 * organisation and are held as pending members of it. Same shape and the
 * same reasons for being a digest rather than a per-event hook: the resolver
 * runs up to three times per sign-in, it runs inside transactions, and
 * `packages/core` is transport-free on purpose.
 *
 * Two audiences. One webhook line per organisation with the counts by
 * reason goes to the operator channel, because "no licence yet" and "no
 * seat free" are things only portal staff can fix. Each organisation's own
 * active admins get a mail through the existing seam — or the primary
 * contact when there are none — because "awaiting approval" is theirs.
 *
 * Silent at zero, and the message carries counts and organisation names but
 * never a person's email: the digest text is written to the log when the
 * webhook is unconfigured, and a chat channel is a wider audience than the
 * queue itself.
 */
export async function pendingMembersDigest(tx: DbConn): Promise<JobResult> {
  const rows = await tx.select({
    orgId: s.organizations.id,
    orgName: s.organizations.name,
    contact: s.organizations.primaryContactEmail,
    reason: s.orgUsers.pendingReason,
    n: count(),
  }).from(s.orgUsers)
    .innerJoin(s.organizations, eq(s.organizations.id, s.orgUsers.orgId))
    .where(eq(s.orgUsers.status, 'pending'))
    .groupBy(s.organizations.id, s.organizations.name, s.organizations.primaryContactEmail, s.orgUsers.pendingReason)
    .orderBy(s.organizations.name);

  const total = rows.reduce((sum, r) => sum + r.n, 0);
  if (!total) return { pending: 0, organisations: 0, notified: false, mailed: 0 };

  const byOrg = new Map<string, {
    name: string;
    contact: string | null;
    counts: Record<keyof typeof LABEL, number>;
  }>();
  for (const r of rows) {
    const entry = byOrg.get(r.orgId)
      ?? { name: r.orgName, contact: r.contact, counts: { awaiting_approval: 0, seats_exhausted: 0, no_licence: 0 } };
    entry.counts[r.reason ?? 'seats_exhausted'] += r.n;
    byOrg.set(r.orgId, entry);
  }

  const describe = (counts: Record<keyof typeof LABEL, number>) =>
    (Object.keys(LABEL) as (keyof typeof LABEL)[])
      .filter((k) => counts[k] > 0)
      .map((k) => `${counts[k]} ${LABEL[k]}`)
      .join(', ');

  const orgs = [...byOrg.entries()];
  const shown = orgs.slice(0, MAX_ORGS);
  const hidden = orgs.length - shown.length;

  const lines = shown.map(([, o]) => `  ${o.name}: ${describe(o.counts)}`);
  if (hidden) lines.push(`  and ${hidden} more ${hidden === 1 ? 'organisation' : 'organisations'}`);

  const notified = await postWebhook([
    `${total} ${total === 1 ? 'person is' : 'people are'} waiting to join`
      + ` ${orgs.length} ${orgs.length === 1 ? 'organisation' : 'organisations'}.`,
    ...lines,
    `Review: ${env.adminUrl}/requests`,
  ].join('\n'));

  // The organisation's own admins, or its primary contact when it has none.
  // No names or addresses of the people waiting: the mail says how many and
  // why, and the portal says who.
  const admins = await tx.select({ orgId: s.portalUsers.orgId, email: s.portalUsers.email })
    .from(s.portalUsers)
    .where(and(
      eq(s.portalUsers.role, 'org_admin'),
      eq(s.portalUsers.isActive, true),
      inArray(s.portalUsers.orgId, orgs.map(([id]) => id)),
    ));
  const adminsBy = new Map<string, string[]>();
  for (const a of admins) {
    if (!a.orgId) continue;
    adminsBy.set(a.orgId, [...(adminsBy.get(a.orgId) ?? []), a.email]);
  }

  let mailed = 0;
  for (const [orgId, o] of orgs) {
    const recipients = adminsBy.get(orgId) ?? (o.contact ? [o.contact] : []);
    const waiting = o.counts.awaiting_approval + o.counts.seats_exhausted + o.counts.no_licence;
    for (const to of recipients) {
      await sendMail({
        to,
        subject: `${waiting} ${waiting === 1 ? 'person is' : 'people are'} waiting to join ${o.name}`,
        body: [
          `${describe(o.counts)}.`,
          `Review the requests: ${env.adminUrl}/org/requests`,
        ].join('\n'),
      });
      mailed += 1;
    }
  }

  return { pending: total, organisations: orgs.length, notified, mailed };
}
