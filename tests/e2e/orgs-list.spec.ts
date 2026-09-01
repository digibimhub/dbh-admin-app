import { test, expect } from './helpers/fixtures';
import { API, portalApi } from './helpers/portal';

/**
 * The Organisations list — the screen an operator lands on to find a customer.
 *
 * Filters live in the URL by design (useUrlState), so a view can be pasted into
 * a ticket and land on the same rows. That claim is only worth making if a cold
 * load of the URL reproduces the view, which is what these assert.
 */

test.describe('organisations list', () => {
  test('renders the seeded world with the numbers an operator acts on', async ({ owner: page }) => {
    await page.goto('/orgs');

    await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();
    await expect(page.getByText(/\d+ customers?/)).toBeVisible();

    for (const name of ['Acme Engineering', 'Byrne Structural', 'DigiBIM Internal']) {
      await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
    }

    // The slug rides under the name, so two orgs with similar names are still
    // distinguishable at a glance.
    await expect(page.getByText('byrne-structural', { exact: true })).toBeVisible();

    // Byrne is the trial that is deliberately at capacity: 4 people, 6 seats.
    const byrne = page.getByRole('row', { name: /Byrne Structural/ });
    await expect(byrne).toContainText('4 / 6');
    // Its licence is inside 30 days, so the date is replaced by a warn pill.
    await expect(byrne).toContainText(/\dd left/);

    // Acme's is far out, so it stays a plain date rather than shouting.
    await expect(page.getByRole('row', { name: /Acme Engineering/ })).toContainText(/\d{4}/);
  });

  test('search filters, lives in the URL, and survives a cold load', async ({ owner: page }) => {
    await page.goto('/orgs');

    // The input is uncontrolled and only commits on Enter — typing alone must
    // not filter, or every keystroke would be a request.
    const search = page.getByLabel('Search organisations');
    await search.fill('byrne');
    await expect(page.getByRole('row', { name: /Acme Engineering/ })).toBeVisible();

    await search.press('Enter');
    await expect(page).toHaveURL(/[?&]q=byrne/);
    await expect(page.getByRole('row', { name: /Byrne Structural/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Acme Engineering/ })).toHaveCount(0);

    // The point of putting it in the URL: paste it into a ticket, get the view.
    await page.goto('/orgs?q=byrne');
    await expect(page.getByRole('row', { name: /Byrne Structural/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Acme Engineering/ })).toHaveCount(0);
  });

  test('the status filter explains an empty result rather than showing nothing', async ({ owner: page }) => {
    await page.goto('/orgs');

    await page.getByLabel('Filter by status').selectOption('suspended');
    await expect(page).toHaveURL(/[?&]status=suspended/);

    await expect(page.getByText('No organisations match these filters')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  });

  test('Clear removes every filter and the query string with them', async ({ owner: page }) => {
    await page.goto('/orgs?q=byrne&status=active');

    await page.getByRole('button', { name: 'Clear', exact: true }).click();

    await expect(page).toHaveURL(/\/orgs$/);
    await expect(page.getByRole('row', { name: /Acme Engineering/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Byrne Structural/ })).toBeVisible();
  });

  test('a row click is a navigation, not a drawer', async ({ owner: page }) => {
    await page.goto('/orgs');

    await page.getByText('Acme Engineering').first().click();
    await page.waitForURL(/\/orgs\/[0-9a-f-]{36}$/);

    await expect(page.getByRole('heading', { name: /Acme Engineering/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Organisations' }).first()).toBeVisible();
  });

  test('the table options menu reveals the optional column and closes on Escape', async ({ owner: page }) => {
    await page.goto('/orgs');

    // Contact is optional, so it starts hidden.
    await expect(page.getByRole('columnheader', { name: 'Contact' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Table options' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    await menu.getByText('Contact', { exact: true }).click();
    await expect(page.getByRole('columnheader', { name: 'Contact' })).toBeVisible();
    await expect(page.getByText('dana@acme-eng.com')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('Export CSV hands the browser a dated file', async ({ owner: page }) => {
    await page.goto('/orgs');
    await page.getByRole('button', { name: 'Table options' }).click();

    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export CSV' }).click();

    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^organisations-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('paging is exact at the API, where the seed can actually reach it', async () => {
    // PAGE_SIZE is 50 and the seed has 3 organisations, so the pager never
    // renders in the browser. Asserting it here is honest; asserting it there
    // would need 51 organisations for one control.
    const api = await portalApi('owner');
    const res = await api.get(`${API}/admin/orgs?pageSize=2&page=2`);
    expect(res.status()).toBe(200);

    const body = await res.json() as { rows: unknown[]; total: number; page: number };
    expect(body.page).toBe(2);
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.rows.length).toBeLessThanOrEqual(2);
  });
});
