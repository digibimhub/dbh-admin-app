import { sql } from 'drizzle-orm';
import { db } from '@app/db';
import { sha256Hex } from '@app/core';
import type { DbConn } from '../lib/db';
import { writeAudit } from '../middleware/audit';

/** Namespace for every advisory lock this service takes. */
const LOCK_CLASS = 0x64626820; // 'dbh '

/** Stable 31-bit id for a job name. */
function lockId(name: string): number {
  return parseInt(sha256Hex(name).slice(0, 8), 16) & 0x7fffffff;
}

export interface JobResult {
  /** Free-form counters for the audit row. */
  [key: string]: number | string | boolean | null;
}

/**
 * Runs a job under a Postgres advisory lock held for the transaction.
 *
 * node-cron fires in-process, so two API instances would otherwise both run
 * every job at 01:00 — double-counting metrics and racing on the same rows.
 * `pg_try_advisory_xact_lock` is non-blocking, so the loser skips instead of
 * queueing up behind the winner, and the lock is released by the commit even
 * if the process dies mid-job.
 *
 * This is the stopgap the plan calls for. It does not make the jobs
 * distributed — it makes running two instances safe until pg-boss lands.
 */
export async function runJob(
  name: string,
  fn: (tx: DbConn) => Promise<JobResult>,
): Promise<JobResult | null> {
  const id = lockId(name);
  const started = Date.now();

  try {
    const result = await db.transaction(async (tx) => {
      const held = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${LOCK_CLASS}, ${id}) AS locked`,
      );
      const row = held.rows[0] as { locked?: unknown } | undefined;
      if (row?.locked !== true) return null;
      return fn(tx);
    });

    if (result === null) return null;

    await writeAudit({
      actorType: 'system',
      action: `job.${name}`,
      after: { ...result, durationMs: Date.now() - started },
    });
    console.log(`[job:${name}] ok in ${Date.now() - started}ms`, result);
    return result;
  } catch (e: unknown) {
    // A failing job must never take the API process down with it.
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[job:${name}] failed after ${Date.now() - started}ms: ${message}`);
    await writeAudit({
      actorType: 'system',
      action: `job.${name}.failed`,
      after: { error: message },
    }).catch(() => undefined);
    return null;
  }
}
