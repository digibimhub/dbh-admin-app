import { and, eq, lt, sql } from 'drizzle-orm';
import { schema as s } from '@app/db';
import type { DbConn } from '../lib/db';
import type { JobResult } from './lock';
import { sendMail } from '../lib/mailer';
import { env } from '../env';

/**
 * `end_date < today` → expired, with a `license_events` row for each.
 *
 * The date comparison runs in Postgres so the cut-off is the database's
 * notion of today, matching `resolveUser`'s inclusive end-date rule rather
 * than the API process's clock.
 */
export async function expireLicenses(tx: DbConn): Promise<JobResult> {
  const expired = await tx.update(s.licenses)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(
      eq(s.licenses.status, 'active'),
      sql`${s.licenses.endDate} < CURRENT_DATE`,
    ))
    .returning({ id: s.licenses.id, orgId: s.licenses.orgId, endDate: s.licenses.endDate });

  if (expired.length) {
    await tx.insert(s.licenseEvents).values(expired.map((l) => ({
      licenseId: l.id,
      eventType: 'expired',
      oldEndDate: l.endDate,
      newEndDate: l.endDate,
      oldStatus: 'active' as const,
      newStatus: 'expired' as const,
      reason: 'end_date passed',
    })));
  }

  return { expired: expired.length };
}

/** No heartbeat for `STALE_DEVICE_DAYS` → `stale`. Analytics only. */
export async function markStaleDevices(tx: DbConn): Promise<JobResult> {
  const cutoff = new Date(Date.now() - env.staleDeviceDays * 86_400_000);
  const stale = await tx.update(s.devices)
    .set({ status: 'stale', updatedAt: new Date() })
    .where(and(eq(s.devices.status, 'active'), lt(s.devices.lastSeenAt, cutoff)))
    .returning({ id: s.devices.id });
  return { marked: stale.length, cutoffDays: env.staleDeviceDays };
}

const ALERT_OFFSETS = [60, 30, 7] as const;

/**
 * Renewal warnings at T-60 / T-30 / T-7.
 *
 * Matches the exact day rather than a range, so a licence generates three
 * emails over its last two months instead of one a day for sixty days.
 */
export async function expiryAlerts(tx: DbConn): Promise<JobResult> {
  const rows = await tx.select({
    licenseId: s.licenses.id,
    orgName: s.organizations.name,
    mode: s.licenses.mode,
    endDate: s.licenses.endDate,
    daysLeft: sql<number>`(${s.licenses.endDate} - CURRENT_DATE)::int`,
  }).from(s.licenses)
    .innerJoin(s.organizations, eq(s.organizations.id, s.licenses.orgId))
    .where(and(
      eq(s.licenses.status, 'active'),
      sql`(${s.licenses.endDate} - CURRENT_DATE) IN (60, 30, 7)`,
    ))
    .orderBy(s.licenses.endDate);

  if (!rows.length) return { alerted: 0 };

  const byOffset = ALERT_OFFSETS.map((d) => ({
    days: d,
    items: rows.filter((r) => r.daysLeft === d),
  })).filter((g) => g.items.length);

  const body = byOffset.map((g) =>
    `T-${g.days}:\n${g.items.map((i) => `  ${i.orgName} (${i.mode}) ends ${i.endDate}`).join('\n')}`,
  ).join('\n\n');

  await sendMail({
    to: env.alertEmailTo || 'operations',
    subject: `Licence renewals: ${rows.length} approaching expiry`,
    body,
  });

  return { alerted: rows.length };
}
