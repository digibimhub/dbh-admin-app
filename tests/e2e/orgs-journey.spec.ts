import { test, expect } from './helpers/fixtures';
import {
  addinSignIn, freshTotp, PORTAL_EMAIL, portalApi, trackOrg, unique, type Grant,
} from './helpers/portal';
import { enterTotp } from './helpers/ui';

/**
 * The reason the Organisations tab exists.
 *
 * Everything before the last step is done through the browser, exactly as an
 * operator would: create the organisation, register its domain, issue it a
 * licence. Then a real add-in sign-in on that domain is attempted through the
 * real endpoints. If the three screens did their job, it is granted; if any of
 * them only looked like it worked, it is not.
 */

test.describe.configure({ mode: 'serial' });

const tag = unique();
const DOMAIN = `e2e-journey-${tag}.test`;
let orgId = '';

test('an operator can take a new customer from nothing to a working sign-in', async ({ owner: page }) => {
  test.slow();

  /* ---- 1. create the organisation, through the dialog ---- */

  await page.goto('/orgs');
  await page.getByRole('button', { name: 'Add organisation' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add organisation' });
  await dialog.getByLabel('Name').fill(`E2E Journey ${tag}`);
  await dialog.getByLabel('Slug').fill(`e2e-journey-${tag}`);
  await dialog.getByRole('button', { name: 'Create organisation' }).click();

  await page.waitForURL(/\/orgs\/[0-9a-f-]{36}$/);
  orgId = page.url().split('/').pop()!;
  // Created through the dialog, so the id arrives in the URL rather than from
  // `createOrg` — global teardown only removes what it has been told about.
  trackOrg(orgId);

  // Before anything else, the header says why nobody can sign in yet.
  await expect(page.locator('dl').first()).toContainText('none');

  /* ---- 2. register the domain ---- */

  const tabs = page.getByRole('navigation', { name: 'Section' });
  await tabs.getByRole('link', { name: 'Domains' }).click();
  await page.getByLabel('Domain').fill(DOMAIN);
  await page.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByText(DOMAIN)).toBeVisible();

  /* ---- 3. issue a licence with exactly one user seat ---- */

  await tabs.getByRole('link', { name: 'Licence' }).click();
  await expect(page.getByRole('heading', { name: 'Issue a licence' })).toBeVisible();

  await page.getByLabel('Mode').selectOption('trial');
  await page.getByLabel('User seats').fill('1');
  await page.getByRole('button', { name: 'Issue licence' }).click();

  // The header now agrees: a trial, one seat, nobody in it.
  const strip = page.locator('dl').first();
  await expect(strip).toContainText('Trial');
  await expect(strip).toContainText('0 / 1');

  /* ---- 4. the first person on that domain is granted ---- */

  const api = await portalApi('owner');
  const first = await addinSignIn(api, {
    sub: `ADSK_E2E_JOURNEY_${tag}_1`,
    email: `first-${tag}@${DOMAIN}`,
    name: 'Journey First',
  }, `sha256:e2e-journey-${tag}-1`);

  expect(first.status, describe(first)).toBe('ok');
  if (first.status === 'ok') expect(first.role).toBe('user');

  /* ---- 5. the portal shows them, in the seat they took ---- */

  await page.reload();
  await expect(strip).toContainText('1 / 1');

  await tabs.getByRole('link', { name: 'People' }).click();
  await expect(page.getByText(`first-${tag}@${DOMAIN}`)).toBeVisible();

  /* ---- 6. the second person waits, and the list says so ---- */

  const second = await addinSignIn(api, {
    sub: `ADSK_E2E_JOURNEY_${tag}_2`,
    email: `second-${tag}@${DOMAIN}`,
    name: 'Journey Second',
  }, `sha256:e2e-journey-${tag}-2`);

  expect(second.status).toBe('denied');
  if (second.status === 'denied') {
    expect(second.code).toBe('seats_exhausted');
    // A soft denial. It must read as waiting, not as rejected.
    expect(second.message.toLowerCase()).toContain('seat');
  }

  await page.goto('/orgs');
  const row = page.getByRole('row', { name: new RegExp(`E2E Journey ${tag}`) });
  await expect(row).toContainText('1 / 1');
  await expect(row).toContainText('1');

  /* ---- 7. removing the domain closes the door, and removes nobody ---- */

  await page.goto(`/orgs/${orgId}/domains`);
  await page.getByRole('button', { name: 'Remove' }).first().click();

  const danger = page.getByRole('dialog', { name: 'Remove domain' });
  await danger.getByRole('textbox').first().fill('e2e journey teardown');
  await enterTotp(page, await freshTotp(PORTAL_EMAIL.owner));
  await danger.getByRole('button', { name: 'Remove domain' }).click();
  await expect(danger).toBeHidden();

  const third = await addinSignIn(api, {
    sub: `ADSK_E2E_JOURNEY_${tag}_3`,
    email: `third-${tag}@${DOMAIN}`,
    name: 'Journey Third',
  }, `sha256:e2e-journey-${tag}-3`);

  expect(third.status).toBe('denied');
  if (third.status === 'denied') expect(third.code).toBe('domain_not_registered');

  // But the person who was already a member is untouched — exactly what the
  // dialog promised before the code was typed.
  await page.goto(`/orgs/${orgId}/people`);
  await expect(page.getByText(`first-${tag}@${DOMAIN}`)).toBeVisible();
});

function describe(grant: Grant): string {
  return grant.status === 'ok' ? 'granted' : `denied: ${grant.code} — ${grant.message}`;
}
