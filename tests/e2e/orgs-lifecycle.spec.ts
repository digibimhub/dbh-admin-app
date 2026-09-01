import { test, expect } from './helpers/fixtures';
import { API, createOrg, freshTotp, PORTAL_EMAIL, portalApi, unique } from './helpers/portal';
import { enterTotp } from './helpers/ui';

/**
 * Editing an organisation, suspending it, putting it back — and what the roles
 * that are not the owner are allowed to see while that happens.
 *
 * Suspension is the most destructive control on the tab: every validation for
 * the organisation is denied at the next check. It is guarded by a reason, a
 * step-up code and an audit row, and none of those three is optional.
 */

let orgId = '';
let tag = '';

test.beforeAll(async () => {
  tag = unique();
  const api = await portalApi('owner');
  const org = await createOrg(api, {
    name: `E2E Lifecycle ${tag}`,
    slug: `e2e-lifecycle-${tag}`,
    primaryContactEmail: `first-${tag}@e2e-lifecycle.test`,
  });
  orgId = org.id;
});

test.describe('editing', () => {
  test('name and contact are editable, the slug is not', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}`);
    await page.getByRole('button', { name: 'Edit' }).click();

    // The slug is in URLs and in the audit log, so it is text even in edit mode.
    await expect(page.getByText('Fixed after creation')).toBeVisible();
    await expect(page.getByLabel('Slug')).toHaveCount(0);

    await page.getByLabel('Name').fill(`E2E Lifecycle ${tag} Renamed`);
    await page.getByLabel('Contact email').fill(`ops-${tag}@e2e-lifecycle.test`);
    await page.getByRole('button', { name: 'Save changes' }).click();

    // Read mode and the page header agree about the new name.
    await expect(page.getByRole('heading', { name: new RegExp(`E2E Lifecycle ${tag} Renamed`) })).toBeVisible();
    await expect(page.getByRole('link', { name: `ops-${tag}@e2e-lifecycle.test` })).toBeVisible();
  });
});

test.describe('suspend and reactivate', () => {
  test('suspending names the organisation and quotes the consequence', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}`);
    await page.getByRole('button', { name: 'Suspend' }).click();

    const dialog = page.getByRole('dialog', { name: 'Suspend organisation' });
    await expect(dialog).toContainText(`e2e-lifecycle-${tag}`);
    await expect(dialog).toContainText('org_suspended');

    const confirm = dialog.getByRole('button', { name: 'Suspend organisation' });
    await expect(confirm).toBeDisabled();

    await dialog.getByRole('textbox').first().fill('e2e suspension');
    await enterTotp(page, await freshTotp(PORTAL_EMAIL.owner));
    await confirm.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('suspended', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reactivate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
  });

  test('a suspended organisation is findable by its status', async ({ owner: page }) => {
    await page.goto('/orgs?status=suspended');
    await expect(page.getByRole('row', { name: new RegExp(`E2E Lifecycle ${tag}`) })).toBeVisible();
  });

  test('reactivating restores it without anybody signing in again', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}`);
    await page.getByRole('button', { name: 'Reactivate' }).click();

    await expect(page.getByRole('button', { name: 'Suspend' })).toBeVisible();
    await expect(page.getByText('active', { exact: true }).first()).toBeVisible();
  });

  test('the API refuses a suspension that has not proved a fresh code', async () => {
    // This context has never stepped up, so the route must not take its word
    // for it however privileged the session is.
    const api = await portalApi('owner');
    const res = await api.post(`${API}/admin/orgs/${orgId}/suspend`, {
      data: { reason: 'e2e without step-up' },
    });

    expect(res.status()).toBe(403);
    expect(await res.text()).toMatch(/step-up/i);
  });
});

test.describe('what the other roles see', () => {
  for (const role of ['viewer', 'support'] as const) {
    test(`${role} is offered no organisation controls`, async ({ pageAs }) => {
      const page = await pageAs(role);

      await page.goto('/orgs');
      await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add organisation' })).toHaveCount(0);

      await page.goto(`/orgs/${orgId}`);
      await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Suspend' })).toHaveCount(0);

      await page.goto(`/orgs/${orgId}/domains`);
      await expect(page.getByRole('heading', { name: 'Registered domains' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Add a domain' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    });
  }

  test('hiding the button is not the boundary — the API refuses a viewer outright', async () => {
    const api = await portalApi('viewer');
    const res = await api.post(`${API}/admin/orgs`, {
      data: { name: 'Viewer Should Not Manage', slug: `viewer-denied-${unique()}` },
    });

    expect(res.status(), await res.text()).toBe(403);
  });

  test('a viewer cannot register a domain either', async () => {
    const api = await portalApi('viewer');
    const res = await api.post(`${API}/admin/orgs/${orgId}/domains`, {
      data: { value: 'viewer-should-not.test' },
    });

    expect(res.status(), await res.text()).toBe(403);
  });
});

test.describe('name validation through the edit form', () => {
  test('an organisation cannot be renamed to whitespace', async ({ owner: page }) => {
    await page.goto(`/orgs/${orgId}`);
    await page.getByRole('button', { name: 'Edit' }).click();

    // Three spaces satisfies the field's own minLength={2}, so the browser
    // submits it, and the API's z.string().min(2) counts spaces as characters.
    await page.getByLabel('Name').fill('   ');
    await page.getByRole('button', { name: 'Save changes' }).click();

    // Assert on what was PERSISTED, not on whatever the page happens to show —
    // the word "Name" is a label on this screen and would match almost anything.
    await expect.poll(async () => {
      const api = await portalApi('owner');
      const res = await api.get(`${API}/admin/orgs/${orgId}`);
      const { org } = await res.json() as { org: { name: string } };
      return org.name;
    }, { message: 'a name of only whitespace should never reach the database' })
      .not.toMatch(/^\s*$/);
  });
});
