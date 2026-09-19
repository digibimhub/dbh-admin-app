import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db, schema as s } from '@app/db';
import { notFound } from './errors';
import { uuidParam } from './params';
import { assertOrgAccess } from '../middleware/auth';

export type MemberRow = typeof s.orgUsers.$inferSelect;

/**
 * The one way a `/admin/users/:id/*` handler gets hold of its member.
 *
 * Validate the id, load the row, 404 if there is none, then 404 again if the
 * caller is an organisation admin and the row belongs to somebody else's
 * organisation. Centralised because the alternative — every handler
 * remembering the scope check — is the kind of rule that holds until the
 * next route is added. A missing row and a foreign row look identical from
 * outside, which is the point.
 */
export async function loadMember(c: Context, id = uuidParam(c)): Promise<MemberRow> {
  const [row] = await db.select().from(s.orgUsers).where(eq(s.orgUsers.id, id)).limit(1);
  if (!row) throw notFound();
  assertOrgAccess(c, row.orgId);
  return row;
}
