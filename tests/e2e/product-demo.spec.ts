import { test, expect } from './helpers/fixtures';
import { addinSignIn, portalApi, trackOrg, unique, type Grant } from './helpers/portal';
import { statStrip } from './helpers/ui';

/**
 * The product, once, end to end — written to be watched rather than trusted.
 *
 * Every other spec in here answers "is this still true?". This one answers
 * "what is this for?": one customer is taken from nothing to a governed ribbon,
 * in the order an operator would actually do it, with the reason for each step
 * written next to it. `docs/product-demo.md` is the voice-over keyed to the
 * numbered steps below, so a step renumbered here is a paragraph renumbered
 * there.
 *
 *   1  create the organisation
 *   2  register its domain
 *   3  issue a licence with seats
 *   4  a real add-in sign-in is granted
 *   5  the next person fills the licence and waits — nobody is rejected
 *   6  the operator gives them a seat, and they resume without signing in
 *   7  somebody the resolver could not place lands in Access requests
 *   8  the people screens: everyone, then one person
 *   9  the settings screens: Roles, Portal users, Audit log
 *
 * WHY THE FILENAME SORTS WHERE IT DOES
 *
 * Alphabetical order is execution order and the suite is serial, so `p` puts
 * this after every `addin-*` and `orgs-*` file — deliberately last, for two
 * reasons. It creates rows on the cross-organisation screens (`/users`,
 * `/requests`, the audit log) that `orgs-list` and `orgs-matrix` count against
 * the seed, so running it earlier would move a count out from under them. And
 * `orgs-login.spec.ts` is named to sort last precisely so it can spend what is
 * left of the login budget on the real form; this file spends none of it —
 * `sessionCookie` reuses the one login per role the run has already paid for —
 * so sorting after it takes nothing away.
 *
 * It also runs in its own Playwright project (`demo`), which is the only one
 * that records video. See `playwright.config.ts`. That means `pnpm test:e2e`
 * skips it entirely; the position above is what happens when somebody asks for
 * both.
 *
 * Watch it:  pnpm test:e2e:demo
 */

test.describe.configure({ mode: 'serial' });

const tag = unique();

const ORG_NAME = `Northgate Design ${tag}`;
const ORG_SLUG = `northgate-${tag}`;

/** Registered to the organisation in step 2. One domain, exactly one org. */
const DOMAIN = `northgate-${tag}.test`;
/** Never registered to anybody — this is what puts step 7 in the queue. */
const OUTSIDE = `freelance-${tag}.test`;

const ALICE = `alice-${tag}@${DOMAIN}`;
const BEN = `ben-${tag}@${DOMAIN}`;
const CHLOE = `chloe-${tag}@${OUTSIDE}`;

let orgId = '';

test('product demo: one customer, from first contact to a governed ribbon', async ({ owner: page }) => {
  // Nine steps, three full OIDC round trips and a dozen screens, over a
  // `next dev` that compiles each route the first time it is asked for — and
  // usually with slowMo on, because the point is to be legible. `test.slow()`
  // only triples the 60s default, which is not enough.
  test.setTimeout(12 * 60_000);

  const api = await portalApi('owner');
  const primary = page.getByRole('navigation', { name: 'Primary' });
  // The licence / expiry / seats band under the organisation's name. It lives
  // in the org layout, so it is on every tab and answers most of this demo.
  const strip = statStrip(page);

  /* ---- 1. create the organisation ------------------------------------- */
  /* A customer is an organisation. Nothing else in the product exists until
     one does: domains hang off it, the licence belongs to it, and every person
     resolves into it. */

  await page.goto('/orgs');
  await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();

  await page.getByRole('button', { name: 'Add organisation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add organisation' });
  await dialog.getByLabel('Name').fill(ORG_NAME);
  await dialog.getByLabel('Slug').fill(ORG_SLUG);
  await dialog.getByRole('button', { name: 'Create organisation' }).click();

  await page.waitForURL(/\/orgs\/[0-9a-f-]{36}$/);
  orgId = page.url().split('/').pop()!;
  // Created through the dialog, so the id arrives in the URL rather than from
  // `createOrg` — global teardown only removes what it has been told about.
  trackOrg(orgId);

  // The header already says why nobody can sign in yet: no licence at all.
  await expect(strip).toContainText('none');

  /* ---- 2. register the domain ----------------------------------------- */
  /* The domain is how a stranger becomes a member without an invitation.
     `org_domains.value` is globally unique, so a domain belongs to exactly one
     organisation and resolution has one answer or none — never an ambiguous
     match to arbitrate. */

  const tabs = page.getByRole('navigation', { name: 'Section' });
  await tabs.getByRole('link', { name: 'Domains' }).click();
  await page.getByLabel('Domain').fill(DOMAIN);
  await page.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByText(DOMAIN)).toBeVisible();

  /* ---- 3. issue a licence with seats ---------------------------------- */
  /* Seats are the commercial control. One User seat and one Coordinator seat,
     so the demo can show both halves of what a full role does: the second
     person waits, and the approval in step 7 has somewhere to land. */

  await tabs.getByRole('link', { name: 'Licence' }).click();
  await expect(page.getByRole('heading', { name: 'Issue a licence' })).toBeVisible();

  await page.getByLabel('Mode').selectOption('trial');
  await page.getByLabel('User seats').fill('1');
  await page.getByLabel('Coordinator seats').fill('1');
  await page.getByRole('button', { name: 'Issue licence' }).click();

  // The header agrees: a trial, two seats, nobody in either.
  await expect(strip).toContainText('Trial');
  await expect(strip).toContainText('0 / 2');

  /* ---- 4. a real add-in sign-in is granted ----------------------------- */
  /* Not a fixture. This is the shipped `/v1/auth` flow against a local OIDC
     issuer: PKCE, the code exchange, the userinfo call, the resolver. Identity
     comes only from Autodesk and is verified server-side — the workstation
     asserts nothing about who is sitting at it. */

  const alice = await addinSignIn(api, {
    sub: `ADSK_DEMO_${tag}_ALICE`,
    email: ALICE,
    name: 'Alice Okonjo',
  }, `sha256:demo-${tag}-alice`);

  expect(alice.status, describe(alice)).toBe('ok');
  if (alice.status === 'ok') {
    // Provisioned into the default role, which grants the everyday panels.
    expect(alice.role).toBe('user');
    // The add-in gates features on SCOPES, never on a role name — so this
    // list, not the word `user`, is what turns the ribbon on.
    expect(alice.scopes).toContain('cleanup');
    expect(alice.scopes).toContain('general');
  }

  // And the portal shows it: one seat taken, one person on the People tab.
  await page.reload();
  await expect(strip).toContainText('1 / 2');
  await tabs.getByRole('link', { name: 'People' }).click();
  await expect(page.getByText(ALICE)).toBeVisible();

  /* ---- 5. the next person fills the licence and waits ------------------ */
  /* A full role does not reject anybody. Ben becomes a member of the right
     organisation in the right role with `status = 'pending'`, and is told he
     is waiting. Nothing is issued to his workstation, but the membership is
     real — which is why step 6 costs one click and no re-authentication. */

  const ben = await addinSignIn(api, {
    sub: `ADSK_DEMO_${tag}_BEN`,
    email: BEN,
    name: 'Ben Halvorsen',
  }, `sha256:demo-${tag}-ben`);

  expect(ben.status).toBe('denied');
  if (ben.status === 'denied') {
    expect(ben.code).toBe('seats_exhausted');
    // A soft denial. It has to read as waiting, not as rejected.
    expect(ben.message.toLowerCase()).toContain('seat');
  }

  await page.reload();
  await expect(page.getByText('1 person is waiting for a seat.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: BEN })).toContainText('awaiting a seat');

  // `seats_exhausted` is NOT an access request. Ben is a member, waiting — the
  // queue is for people the resolver could not place at all. Searched rather
  // than eyeballed, because the queue paginates and "not on this page" is not
  // the claim being made.
  await primary.getByRole('link', { name: 'Requests' }).click();
  await expect(page.getByRole('heading', { name: 'Access requests' })).toBeVisible();

  const queue = page.getByRole('textbox', { name: 'Search access requests' });
  await queue.fill(BEN);
  await queue.press('Enter');
  await expect(page.getByText('Queue is empty')).toBeVisible();

  /* ---- 6. give him a seat ---------------------------------------------- */
  /* Two controls, and the demo shows both: raise the count the customer bought,
     then hand the free seat to the person waiting for it. Occupancy is COUNTED
     and never stored, so there is nothing to reconcile — the number on the
     Licence tab and the state of the row are the same fact. */

  await page.goto(`/orgs/${orgId}/license`);
  await page.getByRole('button', { name: 'Edit seats' }).click();
  await page.getByLabel('Seats for User').fill('2');
  await page.getByRole('button', { name: 'Save seats' }).click();
  await expect(page.getByRole('button', { name: 'Edit seats' })).toBeVisible();

  await page.goto(`/orgs/${orgId}/people`);
  await page.getByRole('row').filter({ hasText: BEN })
    .getByRole('button', { name: 'Give a seat' }).click();

  await expect(page.getByText('1 person is waiting for a seat.')).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: BEN })).toContainText('active');
  // Two of three seats used: two User, and the Coordinator seat still free for
  // the approval in step 7.
  await expect(strip).toContainText('2 / 3');

  /* ---- 7. the approval queue ------------------------------------------- */
  /* Chloe is a contractor on nobody's domain, so the resolver has no
     organisation to put her in and refuses to guess. She is recorded as an
     access request carrying the reason, the machine and the attempt count, and
     an operator decides. Approving takes a seat like any other assignment, so
     it can be refused for a full role rather than quietly overselling the
     licence. */

  const chloe = await addinSignIn(api, {
    sub: `ADSK_DEMO_${tag}_CHLOE`,
    email: CHLOE,
    name: 'Chloe Barrett',
  }, `sha256:demo-${tag}-chloe`);

  expect(chloe.status).toBe('denied');
  if (chloe.status === 'denied') expect(chloe.code).toBe('domain_not_registered');

  await primary.getByRole('link', { name: 'Requests' }).click();
  await queue.fill(CHLOE);
  await queue.press('Enter');

  const row = page.getByRole('row').filter({ hasText: CHLOE });
  await expect(row).toContainText('domain_not_registered');
  await expect(row).toContainText(OUTSIDE);

  // The table is for spotting who to act on; the dialog is for acting.
  await row.getByRole('button', { name: 'Review' }).click();
  const review = page.getByRole('dialog', { name: 'Review access request' });
  await expect(review).toContainText('Email domain is not registered to any organisation');

  await review.getByLabel('Organisation').selectOption(orgId);
  // Not the default role: User is full, and Coordinator is where the seat is.
  await review.getByLabel('Role').selectOption('coordinator');
  await review.getByRole('button', { name: 'Approve' }).click();
  await expect(review).toBeHidden();

  // Gone from the pending queue, and the approved view says where she went.
  await expect(row).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('approved');
  const approved = page.getByRole('row').filter({ hasText: CHLOE });
  await expect(approved).toContainText('approved');
  await expect(approved).toContainText(ORG_NAME);

  /* ---- 8. the people screens ------------------------------------------- */
  /* Users is everyone the platform knows about, across every organisation —
     the screen support opens when somebody rings up. A row opens the person,
     where the machines they have validated from are listed: analytics, not an
     access decision. */

  await primary.getByRole('link', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

  const search = page.getByRole('textbox', { name: 'Search users' });
  await search.fill(tag);
  await search.press('Enter');

  // All three, in one organisation, holding the roles they were given.
  await expect(page.getByRole('row').filter({ hasText: ALICE })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: BEN })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: CHLOE })).toContainText('Coordinator');

  await page.getByRole('row').filter({ hasText: ALICE }).click();
  await page.waitForURL(/\/users\/[0-9a-f-]{36}$/);

  await expect(page.getByRole('heading', { name: 'Alice Okonjo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible();
  // The workstation she signed in from. `devices` is analytics; it may gate on
  // `disabled` and on nothing else.
  await expect(page.getByRole('link', { name: 'E2E-WS' }).first()).toBeVisible();

  /* ---- 9. the settings screens ----------------------------------------- */
  /* Roles are data, not an enum: `key` is permanent and is what the token and
     every member row reference, `name` is the display string and is free to
     change. That split is why a role can be renamed without touching a
     workstation. Portal users is who may operate this console, and the audit
     log is the record of what they did — including the seat handed over in
     step 6. */

  await primary.getByRole('link', { name: 'Settings' }).click();
  await page.waitForURL(/\/settings\/roles$/);

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // One row per role: the display name, then the key beside it. The key is the
  // half that never changes, and it is what the token and every member row
  // carry — which is why renaming the other half is free.
  const coordinator = page.getByRole('row').filter({ hasText: 'coordinator' });
  await expect(coordinator).toContainText('Coordinator');
  await expect(coordinator.getByRole('button', { name: 'Rename' })).toBeVisible();

  const settingsTabs = page.getByRole('navigation', { name: 'Section' });
  await settingsTabs.getByRole('link', { name: 'Portal users' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'admin@yourco.local' })).toBeVisible();

  await settingsTabs.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();

  // Every mutation writes before/after state through middleware, so the seat
  // handed over in step 6 is on the record, with the operator who handed it.
  await page.getByRole('combobox', { name: 'Filter by action' }).selectOption('user.approve');
  await expect(page.getByRole('row').filter({ hasText: 'user.approve' }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'admin@yourco.local' }).first()).toBeVisible();
});

function describe(grant: Grant): string {
  return grant.status === 'ok' ? 'granted' : `denied: ${grant.code} — ${grant.message}`;
}
