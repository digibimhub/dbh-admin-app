import { expect, type Page } from '@playwright/test';

/**
 * Type a six digit code into the authenticator boxes.
 *
 * Each box is `maxLength={1}` and moves focus on to the next one, which is
 * exactly how a person uses it. It is NOT how `fill()` works: fill inserts text
 * through `insertText`, which respects maxlength, so filling the first box with
 * six digits leaves one digit behind and the confirm button correctly stays
 * disabled. Typing is both the honest simulation and the one that works.
 */
export async function enterTotp(page: Page, code: string): Promise<void> {
  const group = page.getByRole('group', { name: 'Six digit authenticator code' });
  const boxes = group.getByRole('textbox');

  // The login screen prefills these from /admin/auth/dev-hint in local dev, and a
  // maxlength=1 box that already holds a digit silently swallows the keystroke.
  for (let i = 5; i >= 0; i--) await boxes.nth(i).fill('');

  await boxes.first().click();
  await page.keyboard.type(code, { delay: 40 });

  // Prove the code actually landed. Without this, a helper that silently drops
  // digits reads as 'the login is broken' three files later.
  for (let i = 0; i < 6; i++) {
    await expect(boxes.nth(i), `digit ${i + 1} did not receive its character`).toHaveValue(code[i]!);
  }
}

/** The stat strip under an organisation's name. */
export const statStrip = (page: Page) => page.locator('dl').first();
