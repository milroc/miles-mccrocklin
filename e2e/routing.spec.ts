// Every URL the site promises to answer, and what it answers with.
import { test, expect, NAV_TIMEOUT } from './fixtures';

const PILLARS = [
  { path: '/', title: /Miles McCrocklin/ },
  { path: '/builder/', title: /Builder/ },
  { path: '/photographer/', title: /Photography/ },
  { path: '/explorer/', title: /Explorer/ },
  { path: '/resume/', title: /Miles McCrocklin/ },
];

test.describe('routing', () => {
  for (const { path, title } of PILLARS) {
    test(`${path} serves its page`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(title);
      // Every page mounts something. A blank #root is the failure this
      // catches — the HTML can be 200 while the bundle throws.
      await expect(page.locator('body')).not.toBeEmpty();
    });
  }

  // Pages serves /builder as the directory; the site must not depend on
  // the trailing slash.
  for (const path of ['/builder', '/photographer', '/explorer', '/resume']) {
    test(`${path} (no trailing slash) serves the same page`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
    });
  }

  // Navigating to a page that IS a 404 makes Chromium log the status as
  // a resource failure. Expected here and nowhere else.
  test.describe(() => {
    test.use({ expectedConsoleErrors: [/Failed to load resource.*404 \(Not Found\)/] });

  test('an unknown path serves the 404 page', async ({ page }) => {
    const response = await page.goto('/no-such-page');
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle(/not found/i);
    // The 404 has to offer a door home, or it is a dead end.
    await expect(page.getByRole('link').first()).toBeVisible();
  });

  // In production these run client-side from 404.html, which is the only
  // reason they work on GitHub Pages at all. They are the URLs with
  // inbound links from outside, so a broken redirect is a broken
  // promise to someone else's link.
  const LEGACY: ReadonlyArray<readonly [string, RegExp]> = [
    ['/long-form', /\/builder\/$/],
    ['/dossier', /\/builder\/$/],
    ['/about', /\/builder\/$/],
    ['/work', /\/builder\/$/],
    ['/photography', /\/photographer\/$/],
  ];
  for (const [from, to] of LEGACY) {
    test(`${from} redirects to its canonical pillar`, async ({ page }) => {
      await page.goto(from);
      await expect(page).toHaveURL(to);
      await expect(page.locator('body')).not.toBeEmpty();
    });
  }
  });

  test('resume is marked noindex', async ({ page }) => {
    await page.goto('/resume/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });

  test('the deploy-critical static files are served', async ({ request }) => {
    // .nojekyll is deliberately empty, so it answers 204 rather than
    // 200. What matters is that none of these are missing.
    for (const path of ['/robots.txt', '/sitemap.xml', '/CNAME', '/.nojekyll']) {
      const response = await request.get(path);
      expect(response.status(), path).toBeLessThan(400);
    }
  });
});

test.describe('cross-page navigation', () => {
  test('the pillar nav reaches every pillar and back home', async ({ page }) => {
    await page.goto('/builder/');
    const nav = page.getByRole('navigation', { name: 'Site sections' });

    // The current pillar is marked, not linked.
    await expect(nav.getByText('builder', { exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await nav.getByRole('link', { name: 'photographer' }).click();
    await expect(page).toHaveURL(/\/photographer\/?$/, { timeout: NAV_TIMEOUT });

    await page
      .getByRole('navigation', { name: 'Site sections' })
      .getByRole('link', { name: 'explorer' })
      .click();
    await expect(page).toHaveURL(/\/explorer\/?$/, { timeout: NAV_TIMEOUT });

    // Explorer's nav overlay fades after 3s of stillness so the globe can
    // spin uncluttered. Keyboard activation is unaffected by the plate
    // dropping pointer-events, so the way home is asserted here;
    // explorer.spec.ts covers the pointer path against the rotate toggle.
    //
    // Selected by attribute rather than by role, though: the faded plate
    // is aria-hidden, and an aria-hidden subtree is absent from the
    // accessibility tree, so getByRole matches nothing once 3s of
    // stillness have passed. That had not bitten yet only because the
    // preceding assertions usually land inside the window. The links stay
    // focusable while hidden, which is issue #83.
    await page.locator('a[aria-label$="home"]').first().press('Enter');
    await expect(page).toHaveURL(/\/$/, { timeout: NAV_TIMEOUT });
  });
});
