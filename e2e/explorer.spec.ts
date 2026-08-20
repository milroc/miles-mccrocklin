// /explorer/ — the fullscreen globe. Every affordance here either drives
// the globe or reads its selection back out, so most of these specs need
// a live WebGL context and skip honestly without one.
import {
  test,
  expect,
  waitForGlobe,
  requireLiveGlobe,
  clickIdleChrome,
} from './fixtures';

test.describe('explorer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explorer/');
  });

  test('the loading wireframe gives way to the globe', async ({ page }) => {
    // Before WebGL arrives the visitor sees a CSS wireframe and the word
    // "loading" — never a blank screen.
    await expect(page.getByText('loading')).toBeAttached();
    await requireLiveGlobe(page);
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('the title plate states the trip counts', async ({ page }) => {
    await expect(page.getByText(/Explorer · \d+ countries · \d+ continents/)).toBeVisible();
  });

  test('rotation toggles off and back on', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /rotation/i });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('rotate: on');

    await clickIdleChrome(page, toggle);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toContainText('rotate: off');

    await clickIdleChrome(page, toggle);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('the chrome hides when idle and returns on activity', async ({ page }) => {
    const overlay = page.locator('[aria-label="Countries"]').locator('..');
    const title = page.getByText(/Explorer · \d+ countries/);
    await expect(title).toBeVisible();

    // The app's idle delay is 3s of stillness. The generous timeout is
    // for the runner, not the product: several software-WebGL globes
    // rendering in parallel can push a setTimeout out by seconds. What
    // is being asserted is that the plate hides at all.
    await expect(title).toHaveAttribute('aria-hidden', 'true', { timeout: 30_000 });

    await page.mouse.move(500, 400);
    await expect(title).not.toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toBeTruthy();
  });

  test('the hidden country index lists every visitable country', async ({ page }) => {
    await requireLiveGlobe(page);
    const index = page.getByRole('navigation', { name: 'Countries' });
    const buttons = index.getByRole('button');
    // Visually hidden by design (clip-path: inset(50%)), so it must stay
    // reachable — but never rendered where a pointer could find it.
    await expect(index).not.toBeInViewport();
    // Populated from the globe's own eligibility set, so an empty index
    // means the globe never handed its controls back.
    await expect.poll(() => buttons.count(), { timeout: 30_000 }).toBeGreaterThan(20);

    const names = await buttons.allInnerTexts();
    expect(new Set(names).size, 'country names are unique').toBe(names.length);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});

test.describe('explorer — country panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explorer/');
    await requireLiveGlobe(page);
  });

  // The index is visually hidden, so the globe canvas sits over it and a
  // mouse click can never reach it. Keyboard activation is the path this
  // control exists to provide, and the one a real user takes.
  async function openCountry(page: import('@playwright/test').Page, nth = 0) {
    const buttons = page
      .getByRole('navigation', { name: 'Countries' })
      .getByRole('button');
    await expect.poll(() => buttons.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    const button = buttons.nth(nth);
    const name = (await button.innerText()).trim();
    await button.press('Enter');
    return name;
  }

  test('selecting a country opens its panel', async ({ page }) => {
    const name = await openCountry(page);
    const panel = page.getByRole('complementary', { name });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test('the selection is written to the URL so it can be shared', async ({ page }) => {
    await openCountry(page);
    await expect.poll(() => new URL(page.url()).searchParams.get('country'), {
      timeout: 10_000,
    }).toBeTruthy();
  });

  test('the close button dismisses the panel and clears the URL', async ({ page }) => {
    const name = await openCountry(page);
    const panel = page.getByRole('complementary', { name });
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toBeHidden();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('country'))
      .toBeNull();
  });

  test('Escape dismisses the panel', async ({ page }) => {
    const name = await openCountry(page);
    const panel = page.getByRole('complementary', { name });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('album links open off-site in a new tab', async ({ page }) => {
    // Not every country has albums; walk the index until one does.
    const buttons = page.getByRole('navigation', { name: 'Countries' }).getByRole('button');
    await expect.poll(() => buttons.count(), { timeout: 30_000 }).toBeGreaterThan(0);

    const total = Math.min(await buttons.count(), 12);
    for (let i = 0; i < total; i++) {
      await buttons.nth(i).press('Enter');
      const albums = page.getByRole('link', { name: /album/i });
      if ((await albums.count()) > 0) {
        const link = albums.first();
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);
        await expect(link).toHaveAttribute('href', /^https?:/);
        return;
      }
      await page.keyboard.press('Escape');
    }
    test.skip(true, 'no country in the first dozen carries an album link');
  });
});

test.describe('explorer — deep links', () => {
  test('?country= opens that country on load', async ({ page }) => {
    await page.goto('/explorer/?country=usa');
    const state = await waitForGlobe(page);
    test.skip(state !== 'live', `globe unavailable in this environment (${state})`);
    // The param speaks ISO-3166; the panel is titled with the globe's
    // own display name, which differs ("United States of America").
    await expect(
      page.getByRole('complementary').filter({ hasText: /United States/ }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('an unknown ?country= is ignored rather than breaking the page', async ({
    page,
  }) => {
    await page.goto('/explorer/?country=atlantis');
    await requireLiveGlobe(page);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(page.locator('canvas')).toBeVisible();
  });
});
