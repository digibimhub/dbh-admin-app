import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../env';
import { runJob, type JobResult } from './lock';
import { expireLicenses, expiryAlerts, markStaleDevices } from './licenses';
import { cleanup } from './usage';
import { pendingRequestsDigest } from './requests';
import type { DbConn } from '../lib/db';

export interface JobDefinition {
  name: string;
  /** Standard five-field cron expression. */
  schedule: string;
  run: (tx: DbConn) => Promise<JobResult>;
}

/**
 * Five scheduled jobs, after three of the original seven were removed.
 *
 * `compute-metrics` and `rollup-usage` wrote to tables nothing read, and
 * `sync-acc` wrote to two whose only consumer called an endpoint that did not
 * exist. All three are gone with the tables; the metrics pair returns when the
 * Usage tab gives them a reader.
 *
 * Everything runs in-process under a Postgres advisory lock (see `lock.ts`),
 * which makes a second API instance safe without making the jobs distributed.
 * Once there is a real need for retries, backoff or visibility, this table is
 * what moves to pg-boss.
 */
export const JOBS: JobDefinition[] = [
  { name: 'expire-licenses',         schedule: '0 2 * * *',  run: expireLicenses },
  { name: 'mark-stale-devices',      schedule: '0 3 * * *',  run: markStaleDevices },
  { name: 'expiry-alerts',           schedule: '0 8 * * *',  run: expiryAlerts },
  { name: 'pending-requests-digest', schedule: '30 8 * * *', run: pendingRequestsDigest },
  { name: 'cleanup',                 schedule: '45 * * * *', run: cleanup },
];

let tasks: ScheduledTask[] = [];

export function startJobs(): void {
  if (!env.enableJobs) {
    console.log('Scheduled jobs are disabled (ENABLE_JOBS=false)');
    return;
  }
  if (tasks.length) return;

  tasks = JOBS.map((job) =>
    cron.schedule(job.schedule, () => {
      // Fire and forget: runJob swallows and records its own failures, so a
      // broken job can never reject into node-cron and take the process down.
      void runJob(job.name, job.run);
    }, { timezone: process.env.TZ || 'UTC' }),
  );

  console.log(`Scheduled ${tasks.length} jobs: ${JOBS.map((j) => j.name).join(', ')}`);
}

export function stopJobs(): void {
  for (const task of tasks) void task.stop();
  tasks = [];
}

/** Runs one job immediately, by name. Used by operators and tests. */
export async function runJobNow(name: string): Promise<JobResult | null> {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  return runJob(job.name, job.run);
}
