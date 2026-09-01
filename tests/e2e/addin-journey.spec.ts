import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  API, freshTotp, PORTAL_EMAIL, portalApi, sessionCookie, trackOrg, unique,
} from './helpers/portal';
import { enterTotp } from './helpers/ui';

/**
 * The whole lifecycle, ending at a ribbon somebody can look at.
 *
 * `addin-flow.spec.ts` already proves the endpoints. What it cannot prove is
 * that a client can act on what they return: it follows the redirect chain with
 * `maxRedirects: 0` and reads `Location` headers, so no browser ever sees the
 * authorize page, the loopback callback, or a panel appearing. In particular
 * nothing anywhere renders a DENIAL — `seats_exhausted` carries a message, an
 * action and a retry_after that no client has ever displayed.
 *
 * So this drives `tests/mock-addin`, which is a real loopback listener on the
 * port it passes as `redirectPort`, and which decides nothing for itself: every
 * panel it shows is a membership test against the `scopes` the API signed.
 *
 * The four ribbon groups map onto the six catalogue slugs, which are compiled
 * into shipped DLLs and cannot be renamed:
 *
 *   Protect  troubleshoot                        admin
 *   Review   coordination, parameters, excel     admin, coordinator
 *   Produce  cleanup                             everyone
 *   General  general (never gated)               everyone, always
 *
 * Watch it:  pnpm test:e2e:demo
 */

test.describe.configure({ mode: 'serial' });

const ADDIN = process.env.MOCK_ADDIN_URL ?? 'http://127.0.0.1:4600';
const tag = unique();
const DOMAIN = `e2e-addin-${tag}.test`;
const FIRST = `first-${tag}@${DOMAIN}`;
const SECOND = `second-${tag}@${DOMAIN}`;

/* ----------------------------------------------------------- mock add-in -- */

async function signInAt(addin: Page, email: string): Promise<void> {
  // Raise the workstation tab. In a headed run this is what makes the story
  // legible: the operator's portal and the engineer's Revit are two different
  // people at two different machines, and the tab switch says so.
  await addin.bringToFront();
  // One mock is one workstation, so signing in as somebody else replaces the
  // session — exactly as switching accounts inside Revit would. Without this
  // the ribbon is still showing the previous grant and offers no email field.
  await addin.request.post(`${ADDIN}/__signout`);
  await addin.goto(`${ADDIN}/`);
  await addin.getByLabel('Autodesk email').fill(email);
  await addin.getByRole('button', { name: 'Sign in' }).click();
  // authorize (4599) -> callback (3002) -> loopback (4600) -> back to the ribbon
  await addin.waitForURL(/127\.0\.0\.1:4600\/$/);
}

/** The daily check the add-in makes on a timer, as a button. */
async function checkLicence(addin: Page): Promise<void> {
  await addin.bringToFront();
  await addin.getByRole('button', { name: 'Check licence' }).click();
  await addin.waitForURL(/127\.0\.0\.1:4600\/$/);
}

/** Raise the operator's tab before doing something in the portal. */
async function atPortal(page: Page, path: string): Promise<void> {
  await page.bringToFront();
  await page.goto(path);
}

async function panels(addin: Page): Promise<string[]> {
  return (await addin.locator('[data-panel]').all())
    .reduce<Promise<string[]>>(async (acc, el) => [
      ...(await acc), (await el.getAttribute('data-panel'))!,
    ], Promise.resolve([]));
}

const state = (addin: Page) => addin.locator('[data-state]');

/* ---------------------------------------------------------------- portal -- */

/** The licence Term card, which owns the licence's own Suspend and Resume. */
const term = (page: Page) => page.locator('section')
  .filter({ has: page.getByRole('heading', { name: 'Term' }) });

async function memberId(api: APIRequestContext, orgId: string, email: string): Promise<string> {
  const res = await api.get(`${API}/admin/users?orgId=${orgId}&pageSize=50`);
  expect(res.status(), await res.text()).toBe(200);
  const { rows } = await res.json() as { rows: { user: { id: string; email: string | null } }[] };
  const found = rows.find((r) => r.user.email === email);
  expect(found, `no member ${email} in org ${orgId}`).toBeTruthy();
  return found!.user.id;
}

async function setRole(api: APIRequestContext, id: string, roleKey: string): Promise<void> {
  const res = await api.post(`${API}/admin/users/${id}/role`, { data: { roleKey } });
  expect(res.status(), await res.text()).toBe(200);
}

/* ------------------------------------------------------------------ test -- */

test('a customer goes from nothing to a working ribbon, and the ribbon follows the licence', async ({ browser }) => {
  // Ten steps, four full OIDC round trips, three daily checks and a step-up
  // that may wait out a TOTP window — over a `next dev` that compiles each
  // route the first time it is asked for. `test.slow()` only triples the 60s
  // default. This is a lifecycle, not a unit.
  test.setTimeout(15 * 60_000);

  const context = await browser.newContext({ baseURL: 'http://localhost:3000' });
  await context.addCookies([await sessionCookie('owner')]);
  const page = await context.newPage();
  const addin = await context.newPage();
  const api = await portalApi('owner');

  /* ---- 1. create the organisation ---- */

  await page.goto('/orgs');
  await page.getByRole('button', { name: 'Add organisation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add organisation' });
  await dialog.getByLabel('Name').fill(`E2E Addin ${tag}`);
  await dialog.getByLabel('Slug').fill(`e2e-addin-${tag}`);
  await dialog.getByRole('button', { name: 'Create organisation' }).click();

  await page.waitForURL(/\/orgs\/[0-9a-f-]{36}$/);
  const orgId = page.url().split('/').pop()!;
  trackOrg(orgId);

  /* ---- 2. register the domain ---- */

  const tabs = page.getByRole('navigation', { name: 'Section' });
  await tabs.getByRole('link', { name: 'Domains' }).click();
  await page.getByLabel('Domain').fill(DOMAIN);
  await page.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByText(DOMAIN)).toBeVisible();

  /* ---- 3. issue a licence with exactly one user seat ---- */

  await tabs.getByRole('link', { name: 'Licence' }).click();
  await page.getByLabel('Mode').selectOption('trial');
  // One user seat, so the second person queues. One of each of the others, so
  // the role moves in step 8 have somewhere to land: a role a licence never
  // bought is a role nobody can hold, and moving into it is a 409.
  await page.getByLabel('User seats').fill('1');
  await page.getByLabel('Coordinator seats').fill('1');
  await page.getByLabel('Admin seats').fill('1');
  await page.getByRole('button', { name: 'Issue licence' }).click();
  await expect(page.locator('dl').first()).toContainText('0 / 3');

  // Grabbed now, while the licence is still active. `GET /admin/orgs/:id/license`
  // filters on status = 'active', so once step 9 suspends it there is no way
  // left to ask for its id — see the note there.
  const licenceRes = await api.get(`${API}/admin/orgs/${orgId}/license`);
  expect(licenceRes.status(), await licenceRes.text()).toBe(200);
  const licenceId = ((await licenceRes.json()) as { license: { id: string } }).license.id;

  /* ---- 4. the first person signs in and gets the everyday ribbon ---- */

  await signInAt(addin, FIRST);

  await expect(state(addin)).toHaveAttribute('data-state', 'granted');
  await expect(addin.locator('[data-field="role"]')).toHaveText('user');
  // The default role is `user`, whose scopes are cleanup + general. So Produce
  // and General, and nothing else — this is the claim the capability matrix
  // makes, rendered.
  expect(await panels(addin)).toEqual(['produce', 'general']);

  /* ---- 5. the second person fills the licence and is told why ---- */

  await signInAt(addin, SECOND);

  await expect(state(addin)).toHaveAttribute('data-state', 'denied');
  await expect(state(addin)).toHaveAttribute('data-code', 'seats_exhausted');
  // The words matter. A denial an operator cannot act on is a support ticket.
  await expect(addin.locator('.deny-message')).toContainText(/seat/i);
  await expect(addin.locator('.deny-action')).toContainText(/seat|manager|portal/i);
  await expect(addin.locator('.deny-retry')).toContainText('900');
  // General survives a denial, because Sign in lives there.
  expect(await panels(addin)).toEqual(['general']);

  /* ---- 6. the portal shows them queued rather than rejected ---- */

  await atPortal(page, `/orgs/${orgId}/people`);
  await expect(page.getByText('waiting for a seat')).toBeVisible();
  await expect(page.getByText(SECOND)).toBeVisible();

  /* ---- 7. the operator frees a seat and lets them in ---- */

  await atPortal(page, `/orgs/${orgId}/license`);
  await page.getByRole('button', { name: 'Edit seats' }).click();
  await page.getByLabel('Seats for User').fill('2');
  await page.getByRole('button', { name: 'Save seats' }).click();
  await expect(page.getByRole('button', { name: 'Edit seats' })).toBeVisible();

  await atPortal(page, `/orgs/${orgId}/people`);
  await page.getByRole('button', { name: 'Give a seat' }).click();
  await expect(page.getByText('waiting for a seat')).toBeHidden();

  // This one DOES need a fresh sign-in: the first attempt was denied, so no
  // session was ever issued and there is no refresh token to carry forward.
  // The "no re-login" property belongs to a grant that already exists — see
  // steps 8 and 10, where it is the thing being proved.
  await signInAt(addin, SECOND);
  await expect(state(addin)).toHaveAttribute('data-state', 'granted');
  expect(await panels(addin)).toEqual(['produce', 'general']);

  /* ---- 8. role changes re-scope the ribbon at the next check ---- */

  const secondId = await memberId(api, orgId, SECOND);

  await setRole(api, secondId, 'coordinator');
  await checkLicence(addin);
  await expect(addin.locator('[data-field="role"]')).toHaveText('coordinator');
  // Coordinator adds coordination, parameters and excel — the Review group.
  // Still no Protect: troubleshoot is admin only.
  expect(await panels(addin)).toEqual(['review', 'produce', 'general']);

  await setRole(api, secondId, 'admin');
  await checkLicence(addin);
  await expect(addin.locator('[data-field="role"]')).toHaveText('admin');
  expect(await panels(addin)).toEqual(['protect', 'review', 'produce', 'general']);

  /* ---- 9. suspending the licence closes the ribbon ---- */

  await atPortal(page, `/orgs/${orgId}/license`);
  // Scoped to the Term section: the page carries an organisation Suspend as
  // well, and suspending the customer is a different act from suspending what
  // they bought.
  await term(page).getByRole('button', { name: 'Suspend', exact: true }).click();

  const danger = page.getByRole('dialog', { name: 'Suspend licence' });
  await danger.getByRole('textbox').first().fill('e2e addin journey');
  await enterTotp(page, await freshTotp(PORTAL_EMAIL.owner));
  await danger.getByRole('button', { name: 'Suspend licence' }).click();
  await expect(danger).toBeHidden();

  await checkLicence(addin);
  await expect(state(addin)).toHaveAttribute('data-state', 'denied');
  // `license_missing`, not `license_suspended`: `getActiveLicense` filters on
  // status = 'active', so a suspended licence is indistinguishable from no
  // licence by the time the resolver looks. The `license_suspended` branch in
  // resolve.ts is unreachable today.
  await expect(state(addin)).toHaveAttribute('data-code', 'license_missing');
  expect(await panels(addin)).toEqual(['general']);

  /* ---- 10. resuming it restores them with no sign-in at all ---- */

  /*
   * Resumed through the API, because the portal cannot do it.
   *
   * `GET /admin/orgs/:id/license` filters on status = 'active', so the moment a
   * licence is suspended its own screen stops being able to see it: the page
   * falls back to "No active licence" and offers to issue a new one, and the
   * Resume button — which exists, at license/page.tsx:222 — is unreachable.
   * Suspending from the portal is currently a one-way door. That is a real
   * defect and not this test's subject, so it is worked around here rather
   * than asserted, and reported separately.
   */
  const resumed = await api.post(`${API}/admin/licenses/${licenceId}/resume`, {
    data: { reason: 'e2e addin journey' },
  });
  expect(resumed.status(), await resumed.text()).toBe(200);

  // The point of the whole file. A denial is soft: it refuses the check but
  // never rotates or revokes the refresh token, so the workstation recovers on
  // its own timer. Nobody is asked to sign in because a bill was paid late.
  await checkLicence(addin);
  await expect(state(addin)).toHaveAttribute('data-state', 'granted');
  expect(await panels(addin)).toEqual(['protect', 'review', 'produce', 'general']);

  await context.close();
});
