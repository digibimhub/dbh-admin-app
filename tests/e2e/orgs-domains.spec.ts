import { test, expect } from './helpers/fixtures';
import { API, createOrg, freshTotp, PORTAL_EMAIL, portalApi, unique } from './helpers/portal';
import { enterTotp } from './helpers/ui';

/**
 * The Domains tab.
 *
 * `org_domains.value` is globally unique, which is the invariant the whole
 * resolver rests on: a verified Autodesk email resolves to one organisation or
 * to none, and there is never a tie to break. Most of this file is about the
 * refusals that keep that true.
 */

let orgId = '';
let tag = '';

test.beforeAll(async () => {
  tag = unique();
  const api = await portalApi('owner');
  // Created out of band: the subject here is the Domains tab, not the dialog.
  const org = await createOrg(api, { name: `E2E Domains ${tag}`, slug: `e2e-domains-${tag}` });
  orgId = org.id;
});

/**
 * A domain of this test's own, registered out of band.
 *
 * The three removal tests used to share the domain an earlier test added. That
 * works exactly until one of them fails: Playwright replaces the worker, the
 * `beforeAll` runs again against a brand new organisation, and the survivors
 * spend a minute looking for a Remove button that was never going to be there.
 * One failure then reads as three.
 */
async function givenADomain(): Promise<string> {
  const api = await portalApi('owner');
  const value = `rm-${unique()}-${tag}.test`;
  const res = await api.post(`${API}/admin/orgs/${orgId}/domains`, { data: { value } });
  expect(res.status(), await res.text()).toBe(201);
  return value;
}

test.describe('domains', () => {
  test('an organisation with no domains explains what that means', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}/domains`);

    await expect(page.getByRole('heading', { name: 'Registered domains' })).toBeVisible();
    await expect(page.getByText('No domains registered')).toBeVisible();
    // The exact denial code an operator will see in the request queue.
    await expect(page.getByText('domain_not_registered')).toBeVisible();
  });

  test('a domain is normalised on the way in', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}/domains`);

    // Deliberately mixed case with padding — an operator pasting from an email.
    await page.getByLabel('Domain').fill(`  E2E-${tag}.Example  `);
    await page.getByRole('button', { name: 'Add domain' }).click();

    await expect(page.getByText(`e2e-${tag}.example`)).toBeVisible();
    await expect(page.getByText('No domains registered')).toHaveCount(0);
    // The input clears, ready for the next one.
    await expect(page.getByLabel('Domain')).toHaveValue('');
  });

  test('the Overview tab names the domain in its how-people-get-in steps', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}`);
    await expect(page.getByText('How people get in')).toBeVisible();
    await expect(page.getByText(`e2e-${tag}.example`)).toBeVisible();
  });

  test('the add button guards the minimum length', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}/domains`);

    const add = page.getByRole('button', { name: 'Add domain' });
    await expect(add).toBeDisabled();

    await page.getByLabel('Domain').fill('abc');
    await expect(add).toBeDisabled();

    await page.getByLabel('Domain').fill('abcd');
    await expect(add).toBeEnabled();
  });

  test('a malformed domain is refused with the rule it broke', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}/domains`);

    // Four characters, so the client guard passes it; no dot, so the API will not.
    await page.getByLabel('Domain').fill('abcd');
    await page.getByRole('button', { name: 'Add domain' }).click();

    await expect(page.getByText(/bare domain/i)).toBeVisible();
  });

  test('a public mailbox domain is refused, with the reason', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}/domains`);

    await page.getByLabel('Domain').fill('gmail.com');
    await page.getByRole('button', { name: 'Add domain' }).click();

    await expect(page.getByText(/public mailbox domain/i)).toBeVisible();
    await expect(page.getByText('gmail.com').first()).toBeVisible();
  });

  test('the same domain twice on the same organisation is refused', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}/domains`);

    await page.getByLabel('Domain').fill(`e2e-${tag}.example`);
    await page.getByRole('button', { name: 'Add domain' }).click();

    await expect(page.getByText(/already registered to this organisation/i)).toBeVisible();
  });

  test('a domain held by another organisation is refused, and names the holder', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}/domains`);

    await page.getByLabel('Domain').fill('acme-eng.com');
    await page.getByRole('button', { name: 'Add domain' }).click();

    await expect(page.getByText(/already registered to Acme Engineering/)).toBeVisible();
    await expect(page.getByText(/A domain maps to one organisation/)).toBeVisible();

    // And nothing was taken from Acme in the attempt.
    await expect(page.getByRole('cell', { name: 'acme-eng.com' })).toHaveCount(0);
  });

  test('removing one demands a reason and a fresh code, and says what survives', async ({ owner: page }) => {
    const value = await givenADomain();
    await page.goto(`/orgs/${orgId}/domains`);

    await page.getByRole('row', { name: value }).getByRole('button', { name: 'Remove' }).click();

    const dialog = page.getByRole('dialog', { name: 'Remove domain' });
    await expect(dialog).toBeVisible();
    // It names the exact thing being changed, verbatim.
    await expect(dialog).toContainText(value);
    // And what does NOT happen, which is the part operators get wrong.
    await expect(dialog).toContainText('removing a domain does not remove anybody');

    const confirm = dialog.getByRole('button', { name: 'Remove domain' });
    await expect(confirm).toBeDisabled();

    await dialog.getByRole('textbox').first().fill('e2e coverage');
    // A reason alone is not enough while a code is still outstanding.
    await expect(confirm).toBeDisabled();

    await enterTotp(page, await freshTotp(PORTAL_EMAIL.owner));
    await expect(confirm).toBeEnabled();
  });

  test('cancelling removes nothing', async ({ owner: page }) => {
    const value = await givenADomain();
    await page.goto(`/orgs/${orgId}/domains`);

    await page.getByRole('row', { name: value }).getByRole('button', { name: 'Remove' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove domain' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name: value })).toBeVisible();
  });

  test('confirming removes it', async ({ owner: page }) => {
    const value = await givenADomain();
    await page.goto(`/orgs/${orgId}/domains`);

    await page.getByRole('row', { name: value }).getByRole('button', { name: 'Remove' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove domain' });
    await dialog.getByRole('textbox').first().fill('e2e removal');
    await enterTotp(page, await freshTotp(PORTAL_EMAIL.owner));
    await dialog.getByRole('button', { name: 'Remove domain' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name: value })).toHaveCount(0);
  });
});
