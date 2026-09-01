import { test as base, type Page } from '@playwright/test';
import { sessionCookie, type PortalRoleName } from './portal';

/**
 * Signed-in pages, without a trip through the login form.
 *
 * The form is exercised once, on purpose, in orgs-login.spec.ts. Everywhere
 * else the session is injected: an accepted TOTP code is recorded as spent, and
 * logins are rate limited five per fifteen minutes per email, so a suite that
 * signs in per test fails for reasons that have nothing to do with the screens
 * it is asserting on.
 */
type Fixtures = {
  /** The default page, already the portal owner. */
  owner: Page;
  /** A page in its own context, as any seeded portal role. */
  pageAs: (role: PortalRoleName) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  owner: async ({ page }, use) => {
    await page.context().addCookies([await sessionCookie('owner')]);
    await use(page);
  },

  pageAs: async ({ browser, baseURL }, use) => {
    const opened: Page[] = [];
    await use(async (role: PortalRoleName) => {
      const context = await browser.newContext({ baseURL });
      await context.addCookies([await sessionCookie(role)]);
      const page = await context.newPage();
      opened.push(page);
      return page;
    });
    for (const page of opened) await page.context().close();
  },
});

export { expect } from '@playwright/test';
