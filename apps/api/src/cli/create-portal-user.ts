import '../env';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { db, schema as s, pool } from '@app/db';
import {
  encryptAtRest, generateTotpSecret, hashPassword, qrToTerminal, totpUri, verifyTotp,
} from '@app/core';
import { createPortalUserSchema } from '@app/shared';
import { writeAudit } from '../middleware/audit';

/**
 * Creates a portal user from the terminal.
 *
 * `portal_users` is the only login path — `routes/admin/auth.ts` selects by
 * email and nothing else issues a portal session — so a database without a row
 * here is a database nobody can administer. `pnpm db:seed` used to be the only
 * thing that created one, which meant "empty database" and "locked out" were
 * the same state. This is the way out of that.
 *
 * The TOTP code is demanded BEFORE the row is written, deliberately. Writing
 * first and enrolling later is how you end up with an account whose second
 * factor lives in an authenticator that never received the secret — the row
 * exists, the password works, and login is still impossible. Refusing to write
 * until a code comes back proves the authenticator holds the same secret the
 * database is about to.
 */

let muted = false;

/**
 * readline echoes what it reads. Passing it a stream we can silence is how the
 * password stays off the screen without reaching into readline's internals.
 */
const output = new Writable({
  write(chunk: Buffer | string, _enc, cb: () => void) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});

// `terminal` follows the real stdin: a TTY gets readline's line editing (and
// therefore needs the muting above), while a pipe gets plain line-at-a-time
// reads with no echo at all — which is what makes the CLI scriptable.
const rl = createInterface({
  input: process.stdin,
  output,
  terminal: Boolean(process.stdin.isTTY),
});

async function ask(prompt: string, fallback = ''): Promise<string> {
  const answer = (await rl.question(prompt)).trim();
  return answer || fallback;
}

async function askHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  muted = true;
  try {
    return (await rl.question('')).trim();
  } finally {
    muted = false;
    process.stdout.write('\n');
  }
}

const ROLES = ['owner', 'admin', 'support', 'viewer'] as const;
type Role = (typeof ROLES)[number];

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  rl.close();
  void pool.end();
  process.exit(1);
}

async function main(): Promise<void> {
  // encryptAtRest reads this directly. Falling back to an ephemeral key here
  // would seal the TOTP secret under a key that dies with the process — the
  // row would look fine and the account would be unusable at the first login.
  if (!process.env.ENCRYPTION_KEY?.trim()) {
    fail('ENCRYPTION_KEY is not set. Set it in .env before creating a user, '
      + 'or the TOTP secret is sealed under a key that will not exist next boot.');
  }

  console.log('\n  Create a portal user\n');

  const email = (await ask('  Email:        ')).toLowerCase();
  const displayName = await ask('  Display name: ');

  let role: Role = 'owner';
  for (;;) {
    const answer = (await ask(`  Role [${ROLES.join('/')}] (owner): `, 'owner')).toLowerCase();
    const match = ROLES.find((r) => r === answer);
    if (match) { role = match; break; }
    console.log(`  Not a portal role. Choose one of: ${ROLES.join(', ')}`);
  }

  const password = await askHidden('  Password:     ');
  const again = await askHidden('  Repeat:       ');
  if (password !== again) fail('The two passwords do not match. Nothing was written.');

  // Same rules the portal's own create-user endpoint applies, so a CLI-made
  // account cannot be weaker than one made through the UI.
  const parsed = createPortalUserSchema.safeParse({
    email, role, password,
    displayName: displayName || undefined,
  });
  if (!parsed.success) {
    fail(`Invalid input:\n  - ${parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('\n  - ')}`);
  }

  const [existing] = await db.select({ id: s.portalUsers.id })
    .from(s.portalUsers).where(eq(s.portalUsers.email, email)).limit(1);
  if (existing) {
    fail(`${email} already has a portal account. `
      + 'Use `pnpm admin:reset-totp <email>` if they cannot get past the second factor.');
  }

  const secret = generateTotpSecret();
  const uri = totpUri(secret, email);

  console.log('\n  Scan this with your authenticator app:\n');
  console.log(qrToTerminal(uri));
  console.log(`\n  ${uri}`);
  console.log(`\n  Or enter the secret by hand: ${secret}\n`);

  let counter = 0;
  for (let attempt = 3; ; attempt -= 1) {
    const code = await ask('  Code from the app: ');
    const check = verifyTotp(secret, code);
    if (check.ok) { counter = check.counter; break; }
    if (attempt <= 1) {
      fail('Three wrong codes. Nothing was written — re-run and scan again. '
        + "If every code fails, check this machine's clock.");
    }
    console.log(`  That code is not valid. ${attempt - 1} attempt(s) left.`);
  }

  const [user] = await db.insert(s.portalUsers).values({
    email,
    displayName: displayName || null,
    role,
    passwordHash: await hashPassword(password),
    passwordChangedAt: new Date(),
    // Sealed exactly as seed/index.ts and the enrolment flow write it:
    // AES-256-GCM, no AAD, so `openTotpSecret` reads it back unchanged.
    totpSecretEnc: encryptAtRest(secret),
    totpEnabled: true,
    totpEnrolledAt: new Date(),
    // The code just proved is now spent. Without this the login replay guard
    // has nothing to compare against and that same code stays usable for the
    // rest of its window.
    lastTotpCounter: counter,
  }).returning();
  if (!user) fail('The insert returned no row. Nothing was created.');

  await writeAudit({
    actorType: 'system',
    action: 'portal.user_create',
    targetType: 'portal_user',
    targetId: user.id,
    after: { email, role, displayName: displayName || null, totpEnabled: true, via: 'cli' },
  });

  console.log(`\n  Created ${email} as ${role}.`);
  console.log('  The code you just entered is spent — log in with the next one.\n');
}

main()
  .then(async () => { rl.close(); await pool.end(); })
  .catch(async (e) => {
    console.error(e);
    rl.close();
    await pool.end();
    process.exit(1);
  });
