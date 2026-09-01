import { test, expect } from '@playwright/test';
import { freshTotp, PORTAL_EMAIL, PORTAL_PASSWORD } from './helpers/portal';
import { enterTotp } from './helpers/ui';

/**
 * The one sign-in through the real form.
 *
 * Every other portal spec injects the session cookie, because an accepted TOTP
 * code is recorded as spent and logins are rate limited five per fifteen
 * minutes per email. This file is the exception that keeps the login screen
 * from being the only untested door into the Organisations tab.
 *
 * It is last alphabetically on purpose: if the budget is going to be exhausted
 * by anything, let it be the test that is about spending it.
 */

test.describe('signing in for real', () => {
  test('the form takes an operator to the Organisations tab', async ({ page }) => {
    test.slow();

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(PORTAL_EMAIL.owner);
    await page.getByLabel('Password').fill(PORTAL_PASSWORD);

    await enterTotp(page, await freshTotp(PORTAL_EMAIL.owner));

    // Logins are five per fifteen minutes per email against an in-memory
    // counter, and the portal deliberately shows one generic message for every
    // failure — so on screen a 429 is indistinguishable from a wrong code. Read
    // it off the response rather than asserting into a wall for three minutes.
    const [login] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/auth/login')),
      page.getByRole('button', { name: 'Continue' }).click(),
    ]);
    const status = login.status();
    test.skip(
      status === 429,
      'the login rate limiter is hot for this email — restart the API to clear it',
    );
    // The body is read ONLY on failure. A successful login navigates away
    // immediately, and `response.text()` on a navigated-away-from response
    // throws — so passing it eagerly as the assertion message turned every
    // successful run into a failure. Only a cold rate limiter ever got here
    // to find out.
    expect(login.status(), status === 200 ? 'ok' : await login.text()).toBe(200);

    await page.waitForURL(/localhost:3000\/$/);
    // The dashboard has a nav link and a summary card with the same name.
    await page.getByRole('navigation').getByRole('link', { name: 'Organisations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Acme Engineering/ })).toBeVisible();
  });

  test('a wrong password says nothing useful to somebody guessing', async ({ page }) => {
    await page.goto('/login');

    // An address with no account: the response must be indistinguishable from a
    // real account with a wrong password, and it locks nobody out of the suite.
    await page.getByLabel('Email').fill('nobody@yourco.local');
    await page.getByLabel('Password').fill('not-the-password');
    await enterTotp(page, '000000');

    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/check|incorrect|try again|could not/i).first()).toBeVisible();
  });

  test('the Organisations tab is not reachable without a session', async ({ page }) => {
    await page.goto('/orgs');
    // Either bounced to the login screen, or shown nothing but an error — what
    // must not happen is a rendered list of customers.
    await expect(page.getByRole('row', { name: /Acme Engineering/ })).toHaveCount(0);
  });
});
