// Every URL the site promises to answer, and what it answers with.
import { test, expect } from './fixtures';

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

  test('an unknown path serves the 404 page', async ({ page }) => {
    const response = await page.goto('/no-such-page');
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle(/not found/i);
    // The 404 has to offer a door home, or it is a dead end.
    await expect(page.getByRole('link').first()).toBeVisible();
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
    await expect(page).toHaveURL(/\/photographer\/?$/);

    await page
      .getByRole('navigation', { name: 'Site sections' })
      .getByRole('link', { name: 'explorer' })
      .click();
    await expect(page).toHaveURL(/\/explorer\/?$/);

    // Explorer's nav overlay fades after 3s of stillness so the globe can
    // spin uncluttered, and the hidden plate stops taking pointer events.
    // Keyboard activation is unaffected by that, so the way home is
    // asserted here; explorer.spec.ts covers the pointer path against the
    // rotate toggle.
    await page.getByRole('link', { name: /home/i }).first().press('Enter');
    await expect(page).toHaveURL(/\/$/);
  });
});
