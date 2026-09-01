import '../../src/env';
import { eq, sql } from 'drizzle-orm';
import { db, schema as s, pool } from '@app/db';
import { writeAudit } from '../middleware/audit';

const email = process.argv[2];
const reasonIdx = process.argv.indexOf('--reason');
const reason = reasonIdx >= 0 ? process.argv[reasonIdx + 1] : 'cli reset';

if (!email) {
  console.error('usage: pnpm admin:reset-totp <email> --reason "..."');
  process.exit(1);
}

const [user] = await db.select().from(s.portalUsers).where(eq(s.portalUsers.email, email)).limit(1);
if (!user) {
  console.error('no portal user with that email');
  process.exit(1);
}

await db.update(s.portalUsers).set({
  totpSecretEnc: null,
  totpEnabled: false,
  totpResetRequired: true,
  sessionEpoch: sql`${s.portalUsers.sessionEpoch} + 1`,
}).where(eq(s.portalUsers.id, user.id));

await writeAudit({
  actorType: 'system',
  action: 'portal.totp_reset',
  targetType: 'portal_user',
  targetId: user.id,
  after: { reason, email },
});

console.log(`TOTP reset for ${email}. They must re-enrol at next login.`);
await pool.end();
