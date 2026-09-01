import type { Context, Next } from 'hono';
import { db, schema as s } from '@app/db';
import type { DbConn } from '../lib/db';
import { clientIp } from './ratelimit';

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by `audit()` so the fallback middleware does not double-write. */
    auditWritten: boolean;
  }
}

/**
 * Anything matching these never reaches audit_log. Audit rows are read by
 * support staff and exported; a password hash or an APS token sitting in
 * before_state would outlive every rotation policy we have.
 */
const SENSITIVE_KEY = /(password|secret|totp|token|credential|authorization|cookie|turnstile|private)/i;
const REDACTED = '[redacted]';

/** Deep-copies a value, replacing sensitive fields with a marker. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export interface AuditInput {
  orgId?: string | null;
  actorType: 'portal_user' | 'system' | 'addin';
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

/** Low-level writer. Prefer `audit(c, ...)` inside a request. */
export async function writeAudit(input: AuditInput, conn: DbConn = db): Promise<void> {
  await conn.insert(s.auditLog).values({
    orgId: input.orgId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    beforeState: input.before === undefined ? null : redact(input.before),
    afterState: input.after === undefined ? null : redact(input.after),
    ip: input.ip,
  });
}

/**
 * Route-level audit. Fills actor and IP from the request and marks the
 * request as audited so `auditMutations` skips its fallback row.
 */
export async function audit(
  c: Context,
  input: Omit<AuditInput, 'actorType' | 'ip'> & {
    actorType?: AuditInput['actorType'];
  },
  conn: DbConn = db,
): Promise<void> {
  // Unauthenticated routes (login) pass the actor explicitly; everything
  // behind requireSession picks it up from the context.
  const user = c.get('portalUser');
  c.set('auditWritten', true);
  await writeAudit({
    ...input,
    actorType: input.actorType ?? (user || input.actorId ? 'portal_user' : 'system'),
    actorId: input.actorId ?? user?.id ?? null,
    actorEmail: input.actorEmail ?? user?.email ?? null,
    ip: clientIp(c),
  }, conn);
}

/**
 * Safety net for the invariant "every non-GET admin route writes audit_log".
 * Routes that call `audit()` supply before/after; anything that forgets still
 * leaves a trace here, and the missing detail is visible in the log rather
 * than silently absent.
 */
export async function auditMutations(c: Context, next: Next) {
  await next();

  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  if (c.res.status >= 400) return;
  if (c.get('auditWritten')) return;

  const user = c.get('portalUser');
  await writeAudit({
    actorType: user ? 'portal_user' : 'system',
    actorId: user?.id ?? null,
    actorEmail: user?.email ?? null,
    // Path only. Request bodies here would carry passwords and TOTP codes.
    action: `${method.toLowerCase()} ${c.req.path}`,
    ip: clientIp(c),
  });
}
