/**
 * The write half of a successful add-in validation: device row, usage
 * counters, activity stamps and the signed access token.
 *
 * Shared by /v1/auth/exchange and /v1/token/refresh so the heartbeat and the
 * first sign-in cannot drift apart.
 */
import { sql } from 'drizzle-orm';
import { schema as s } from '@app/db';
import type { ResolveResult } from '@app/core';
import { signAddinJwt } from '@app/core';
import type { DeviceInfo } from '@app/shared';
import { env } from '../env';
import type { DbConn } from './db';
import { getSigningKey } from './signing';
import { touchActivity } from './resolve-deps';

export type Granted = Extract<ResolveResult, { ok: true }>;

/**
 * Session lifetimes.
 *
 * `SESSION_IDLE_MS` slides forward on every successful refresh, so somebody
 * who uses Revit weekly is never signed out for having been signed in too
 * long. `SESSION_MAX_MS` is stamped once at issue and never moves, so a stolen
 * refresh token still has a horizon. `REFRESH_REPLAY_MS` is how long a
 * rotated-away token keeps answering: long enough to cover a retry whose reply
 * was lost, short enough that a token in somebody else's hands is theft.
 */
export const SESSION_IDLE_MS = 30 * 86_400_000;
export const SESSION_MAX_MS = 90 * 86_400_000;
export const REFRESH_REPLAY_MS = 60_000;

/** 09:00 local the next day, matching the `next_check` claim in the spec. */
export function nextCheckAt(from = new Date()): string {
  const d = new Date(from.getTime() + 86_400_000);
  d.setUTCHours(9, 0, 0, 0);
  return d.toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function upsertDevice(
  conn: DbConn,
  input: {
    orgId: string;
    orgUserId: string;
    device: DeviceInfo;
    ip: string | null;
  },
): Promise<string> {
  const versions = input.device.revitVersion ? [input.device.revitVersion] : [];
  const [row] = await conn.insert(s.devices).values({
    orgId: input.orgId,
    orgUserId: input.orgUserId,
    deviceHash: input.device.deviceHash,
    machineName: input.device.machineName,
    revitVersions: versions,
    addinVersion: input.device.addinVersion,
    lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: [s.devices.orgId, s.devices.deviceHash],
    set: {
      lastSeenAt: new Date(),
      orgUserId: input.orgUserId,
      machineName: input.device.machineName,
      addinVersion: input.device.addinVersion,
      updatedAt: new Date(),
      // Union, not replace: a workstation with several Revit versions
      // installed must not lose the others every heartbeat.
      revitVersions: sql`(
        SELECT COALESCE(array_agg(DISTINCT v), '{}'::text[])
        FROM unnest(${s.devices.revitVersions} || excluded.revit_versions) AS v
        WHERE v IS NOT NULL AND v <> ''
      )`,
      // A device an operator disabled stays disabled; resolveUser has already
      // denied it by this point, so we never see it here — but be explicit.
      status: sql`${s.devices.status}`,
    },
  }).returning({ id: s.devices.id });
  return row!.id;
}

export async function upsertUsage(
  conn: DbConn,
  input: {
    orgId: string;
    orgUserId: string;
    deviceId: string;
    device: DeviceInfo;
    isLaunch: boolean;
    usageDate?: string;
  },
): Promise<void> {
  await conn.insert(s.usageDaily).values({
    orgId: input.orgId,
    orgUserId: input.orgUserId,
    deviceId: input.deviceId,
    usageDate: input.usageDate ?? today(),
    launches: 1,
    heartbeats: 1,
    revitVersion: input.device.revitVersion,
    addinVersion: input.device.addinVersion,
  }).onConflictDoUpdate({
    target: [s.usageDaily.orgId, s.usageDaily.orgUserId, s.usageDaily.deviceId, s.usageDaily.usageDate],
    set: {
      heartbeats: sql`${s.usageDaily.heartbeats} + 1`,
      launches: input.isLaunch
        ? sql`${s.usageDaily.launches} + 1`
        : sql`${s.usageDaily.launches}`,
      revitVersion: sql`COALESCE(excluded.revit_version, ${s.usageDaily.revitVersion})`,
      addinVersion: sql`COALESCE(excluded.addin_version, ${s.usageDaily.addinVersion})`,
      lastSeenAt: new Date(),
    },
  });
}

export interface AccessToken {
  accessToken: string;
  expiresIn: number;
  nextCheck: string;
}

export async function signAccessToken(result: Granted, email: string): Promise<AccessToken> {
  const signing = await getSigningKey();
  const nextCheck = nextCheckAt();
  const accessToken = await signAddinJwt({
    privatePem: signing.privatePem,
    kid: signing.kid,
    issuer: env.apiPublicUrl,
    claims: {
      sub: result.userId,
      org: result.orgId,
      org_name: result.orgName,
      email,
      role: result.roleKey,
      scopes: result.scopes,
      license_end: result.license.endDate,
      grace_days: result.license.graceDays,
      next_check: nextCheck,
    },
  });
  return { accessToken, expiresIn: 86400, nextCheck };
}

/** Device + usage + activity, i.e. everything a grant writes. */
export async function recordGrant(
  conn: DbConn,
  input: {
    result: Granted;
    device: DeviceInfo;
    ip: string | null;
    isLaunch: boolean;
  },
): Promise<{ deviceId: string }> {
  const deviceId = await upsertDevice(conn, {
    orgId: input.result.orgId,
    orgUserId: input.result.userId,
    device: input.device,
    ip: input.ip,
  });
  await upsertUsage(conn, {
    orgId: input.result.orgId,
    orgUserId: input.result.userId,
    deviceId,
    device: input.device,
    isLaunch: input.isLaunch,
  });
  await touchActivity(conn, input.result.userId);
  return { deviceId };
}
