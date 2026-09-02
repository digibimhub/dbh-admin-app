import { count, eq, sql } from 'drizzle-orm';
import { schema as s } from '@app/db';
import type { DbConn } from '../lib/db';
import type { JobResult } from './lock';
import { postWebhook } from '../lib/notify';
import { env } from '../env';

/** Domains listed individually before the tail is summarised as a count. */
const MAX_DOMAINS = 10;

/**
 * Daily "somebody is waiting" digest for the access-request queue.
 *
 * A request lands in `access_requests` when an add-in user's email domain
 * matches no organisation, and nothing else tells an operator it is there —
 * the count only shows on the dashboard, which nobody has open at 09:00.
 *
 * **A digest, deliberately, and not a per-event webhook.** Three reasons, all
 * of them load-bearing:
 *
 *  - `resolveUser` runs up to three times in one add-in journey (the two calls
 *    in `routes/addin/auth.ts` and the one in `routes/addin/validate.ts`), so a
 *    hook on the resolve path would fire two or three times for one person
 *    knocking on the door once.
 *  - `upsertAccessRequest` (`lib/resolve-deps.ts`) frequently runs inside a
 *    transaction. An HTTP call there holds a pooled connection open across a
 *    network round-trip, and a rollback afterwards would leave a notification
 *    announcing a request that no longer exists.
 *  - `packages/core` is transport-free on purpose. The resolve logic does not
 *    get to know that Slack exists.
 *
 * Silent at zero: the job still runs and still records `pending: 0` in
 * `audit_log`, but posts nothing. A daily "nothing to do" message is how a
 * channel teaches people to ignore it.
 *
 * The message carries counts, email domains and a link — no names, no
 * addresses, no device or machine identifiers. The digest text is also written
 * to the log whenever the webhook is unconfigured, so the same discipline
 * `mailer.ts` documents applies here.
 */
export async function pendingRequestsDigest(tx: DbConn): Promise<JobResult> {
  // Same shape as the dashboard's pendingRequests tile, counted live.
  const [pending] = await tx.select({ n: count() }).from(s.accessRequests)
    .where(eq(s.accessRequests.status, 'pending'));
  const total = pending?.n ?? 0;

  if (!total) return { pending: 0, notified: false };

  const byDomain = await tx.select({
    domain: s.accessRequests.emailDomain,
    n: count(),
    oldestDays: sql<number>`(CURRENT_DATE - min(${s.accessRequests.firstAttemptAt})::date)::int`,
  }).from(s.accessRequests)
    .where(eq(s.accessRequests.status, 'pending'))
    .groupBy(s.accessRequests.emailDomain)
    .orderBy(sql`count(*) DESC, ${s.accessRequests.emailDomain} ASC`);

  const oldestDays = byDomain.reduce((max, d) => Math.max(max, d.oldestDays), 0);
  const shown = byDomain.slice(0, MAX_DOMAINS);
  const hidden = byDomain.length - shown.length;

  const lines = shown.map((d) => `  ${d.domain ?? 'unknown domain'}: ${d.n}`);
  if (hidden) lines.push(`  and ${hidden} more ${hidden === 1 ? 'domain' : 'domains'}`);

  const body = [
    `${total} access ${total === 1 ? 'request is' : 'requests are'} waiting for approval`
      + ` (oldest waiting ${oldestDays} ${oldestDays === 1 ? 'day' : 'days'}).`,
    ...lines,
    `Review: ${env.adminUrl}/requests`,
  ].join('\n');

  const notified = await postWebhook(body);

  return { pending: total, domains: byDomain.length, oldestDays, notified };
}
