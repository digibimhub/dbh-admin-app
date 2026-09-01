import { test, expect } from './helpers/fixtures';
import { unique } from './helpers/portal';

/**
 * The Add organisation dialog.
 *
 * A slug is in URLs and in the audit log and never changes, so the moment it is
 * accepted is the only moment it can be got right. Most of what is asserted
 * here is about that field.
 */

test.describe('add organisation', () => {
  test('suggests a slug from the name, and stops once the slug is touched', async ({ owner: page }) => {
    await page.goto('/orgs');
    await page.getByRole('button', { name: 'Add organisation' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add organisation' });
    await expect(dialog).toBeVisible();

    const name = dialog.getByLabel('Name');
    const slug = dialog.getByLabel('Slug');

    await name.fill('Nordvest Rådgivning AS');
    await expect(slug).toHaveValue('nordvest-r-dgivning-as');

    // Once a human has an opinion about the slug, the name must stop overwriting
    // it — otherwise correcting the transliteration is impossible.
    await slug.fill('nordvest-radgivning');
    await name.fill('Nordvest Rådgivning AS (Oslo)');
    await expect(slug).toHaveValue('nordvest-radgivning');
  });

  test('creating one lands on it, and it appears in the list', async ({ owner: page }) => {
    const tag = unique();

    await page.goto('/orgs');
    const before = await page.getByText(/\d+ customers?/).textContent();
    const beforeCount = Number(before?.match(/\d+/)?.[0] ?? 0);

    await page.getByRole('button', { name: 'Add organisation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add organisation' });

    await dialog.getByLabel('Name').fill(`E2E Create ${tag}`);
    await dialog.getByLabel('Slug').fill(`e2e-create-${tag}`);
    await dialog.getByLabel('Contact email').fill(`ops-${tag}@e2e-create.test`);

    // The dialog says so in as many words, and it is the reason the next stop
    // is the Licence tab.
    await expect(dialog).toContainText('It starts with no licence');

    await dialog.getByRole('button', { name: 'Create organisation' }).click();
    await page.waitForURL(/\/orgs\/[0-9a-f-]{36}$/);

    await expect(page.getByRole('heading', { name: new RegExp(`E2E Create ${tag}`) })).toBeVisible();
    await expect(page.getByText(`e2e-create-${tag}`).first()).toBeVisible();
    // Status pill text is lower case in the DOM; the capitals are CSS.
    await expect(page.getByText('active', { exact: true }).first()).toBeVisible();

    // No licence means nobody can sign in yet, and the header says so loudly.
    const strip = page.locator('dl').first();
    await expect(strip).toContainText('none');

    await page.goto('/orgs');
    await expect(page.getByText(`${beforeCount + 1} customers`)).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(`E2E Create ${tag}`) });
    await expect(row).toContainText('0 / 0');
  });

  test('the create button refuses to submit an incomplete organisation', async ({ owner: page }) => {
    await page.goto('/orgs');
    await page.getByRole('button', { name: 'Add organisation' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add organisation' });
    const create = dialog.getByRole('button', { name: 'Create organisation' });

    await expect(create).toBeDisabled();

    await dialog.getByLabel('Name').fill('A');
    await expect(create).toBeDisabled();

    await dialog.getByLabel('Name').fill('Ab');
    await expect(create).toBeEnabled();

    await dialog.getByLabel('Slug').fill('');
    await expect(create).toBeDisabled();
  });

  test('a slug that is not a slug never reaches the API', async ({ owner: page }) => {
    await page.goto('/orgs');
    await page.getByRole('button', { name: 'Add organisation' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add organisation' });
    await dialog.getByLabel('Name').fill('Not A Slug Ltd');
    const slug = dialog.getByLabel('Slug');
    await slug.fill('Not A Slug');

    let requested = false;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/admin/orgs')) requested = true; });

    await dialog.getByRole('button', { name: 'Create organisation' }).click();

    // The browser blocks the submit on the pattern, so there is no error note
    // to read — the field itself is the report.
    const mismatch = await slug.evaluate((el) => (el as HTMLInputElement).validity.patternMismatch);
    expect(mismatch, 'the slug field should report a pattern mismatch').toBe(true);
    expect(requested, 'an invalid slug must not be sent').toBe(false);
    await expect(dialog).toBeVisible();
  });

  test('a duplicate slug is refused in the words the API used', async ({ owner: page }) => {
    await page.goto('/orgs');
    await page.getByRole('button', { name: 'Add organisation' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add organisation' });
    await dialog.getByLabel('Name').fill('Acme Engineering Again');
    await dialog.getByLabel('Slug').fill('acme-engineering');
    await dialog.getByRole('button', { name: 'Create organisation' }).click();

    await expect(dialog).toContainText('The slug "acme-engineering" is already in use.');
    // Nothing typed is lost — the operator only has to change the slug.
    await expect(dialog.getByLabel('Name')).toHaveValue('Acme Engineering Again');
  });

  test('Cancel discards what was typed', async ({ owner: page }) => {
    await page.goto('/orgs');
    await page.getByRole('button', { name: 'Add organisation' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add organisation' });
    await dialog.getByLabel('Name').fill('Abandoned Ltd');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Add organisation' }).click();
    await expect(page.getByRole('dialog', { name: 'Add organisation' }).getByLabel('Name')).toHaveValue('');
  });

  test('the dialog behaves like a dialog', async ({ owner: page }) => {
    await page.goto('/orgs');
    const trigger = page.getByRole('button', { name: 'Add organisation' });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Add organisation' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus must move INTO the dialog, or a keyboard user is still on the page
    // underneath. Which element it lands on is recorded rather than asserted —
    // see the note in the report about Close winning over the first field.
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const dialogEl = document.querySelector('[role="dialog"]');
      return {
        inside: Boolean(el && dialogEl?.contains(el)),
        label: el?.getAttribute('aria-label') ?? el?.tagName ?? 'none',
      };
    });
    expect(focused.inside, `focus landed outside the dialog (${focused.label})`).toBe(true);
    console.log(`    [note] focus after opening the dialog: ${focused.label}`);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
