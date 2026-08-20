// The splash is the one page that is fully rendered before any
// JavaScript runs, so it gets tested twice: as served, and as hydrated.
import { test, expect, waitForGlobe } from './fixtures';

test.describe('splash', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('the wordmark, tagline and portrait are present', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /McCrocklin/,
    );
    await expect(page.locator('img[src*="portrait"]')).toBeVisible();
    await expect(page.locator('p').first()).not.toBeEmpty();
  });

  test('the globe hero links to the explorer', async ({ page }) => {
    const hero = page.getByRole('link', { name: /explorer/i }).first();
    await expect(hero).toHaveAttribute('href', '/explorer/');
    await hero.click();
    await expect(page).toHaveURL(/\/explorer\/?$/);
  });

  test('both door rows link to their pillar', async ({ page }) => {
    for (const [id, href] of [
      ['builder', '/builder/'],
      ['photographer', '/photographer/'],
    ] as const) {
      const door = page.locator(`a[data-id="${id}"]`);
      await expect(door).toHaveAttribute('href', href);
      await expect(door.locator('img')).toBeVisible();
    }
  });

  test('every social link opens off-site in a new tab', async ({ page }) => {
    const socials = page.getByRole('navigation', { name: /internet/i });
    const links = socials.getByRole('link');
    await expect(links).toHaveCount(6);

    for (const link of await links.all()) {
      const href = await link.getAttribute('href');
      expect(href).toBeTruthy();
      if (href!.startsWith('mailto:')) continue;
      // An external link that opens in place loses the visitor.
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noreferrer/);
    }
  });

  test('the WebGL globe replaces the CSS wireframe', async ({ page }) => {
    const state = await waitForGlobe(page);
    test.skip(state !== 'live', `globe unavailable in this environment (${state})`);
    // data-live is what crossfades the wireframe out. If it never lands
    // the visitor stares at a static wireframe forever.
    await expect(page.locator('[data-splash-globe-box]')).toHaveAttribute(
      'data-live',
      'true',
    );
    await expect(page.locator('[data-splash-globe-mount] canvas')).toBeVisible();
  });

  test('the chrome is real HTML before any JavaScript runs', async ({ browser }) => {
    // The prerender is the whole point of ssr-entry.tsx: this page has
    // to be readable with JS off, and it has to be the same page.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /McCrocklin/,
    );
    await expect(page.locator('a[data-id="builder"]')).toHaveAttribute(
      'href',
      '/builder/',
    );
    await expect(page.locator('a[data-id="photographer"]')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: /internet/i }).getByRole('link'),
    ).toHaveCount(6);
    await context.close();
  });
});
