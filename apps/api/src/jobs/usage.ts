import { sql } from 'drizzle-orm';
import type { DbConn } from '../lib/db';
import type { JobResult } from './lock';
import { env } from '../env';

/**
 * Hourly housekeeping.
 *
 * Expired `oauth_states` rows hold a PKCE verifier, so leaving them around is
 * both a growing table and a needless store of credential material.
 *
 * Pending access requests older than 90 days are closed off as `expired` — the
 * status exists for exactly this and nothing else ever sets it, so without this
 * the pending queue only ever grows.
 *
 * `usage_daily` is pruned here rather than in a monthly rollup. The rollup
 * tables it used to feed (`usage_monthly`, `org_metrics_daily`) were written
 * nightly and read by nothing, so they are gone; when the Usage tab lands they
 * come back with a reader attached, and the retention window is the thing to
 * revisit then.
 */
export async function cleanup(tx: DbConn): Promise<JobResult> {
  const states = await tx.execute(sql`
    DELETE FROM oauth_states WHERE expires_at < now() - interval '1 hour'
  `);

  const requests = await tx.execute(sql`
    UPDATE access_requests SET status = 'expired'
    WHERE status = 'pending' AND last_attempt_at < now() - interval '90 days'
  `);

  const usage = await tx.execute(sql`
    DELETE FROM usage_daily
    WHERE usage_date < CURRENT_DATE - ${env.usageRetentionDays}::int
  `);

  /**
   * A session past its absolute horizon can never be refreshed again, so the
   * row is only taking up space and holding encrypted APS material. `expiresAt`
   * slides on every refresh; `maxLifetimeAt` does not, which is what makes this
   * safe to delete on rather than a sliding window that never fires.
   */
  const sessions = await tx.execute(sql`
    DELETE FROM addin_sessions WHERE max_lifetime_at < now()
  `);

  return {
    oauthStatesPurged: states.rowCount ?? 0,
    accessRequestsExpired: requests.rowCount ?? 0,
    usageRowsPruned: usage.rowCount ?? 0,
    deadSessionsPurged: sessions.rowCount ?? 0,
    retentionDays: env.usageRetentionDays,
  };
}
