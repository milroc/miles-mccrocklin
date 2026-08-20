// Phone viewport. Three surfaces take a genuinely different branch below
// 720px — the splash restacks, the filter dropdowns become bottom sheets
// with their own header and backdrop, and the masonry recomputes its
// column count — so each is exercised on a real touch device profile
// rather than a narrowed desktop one.
import { test, expect, resultCount } from './fixtures';

test.describe('mobile — splash', () => {
  test('restacks to one column with every door reachable', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Stacked, so the doors sit below the fold — reachable by scrolling
    // is the contract here, not visible on first paint.
    for (const id of ['builder', 'photographer']) {
      const door = page.locator(`a[data-id="${id}"]`);
      await door.scrollIntoViewIfNeeded();
      await expect(door).toBeInViewport({ ratio: 0.5 });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    // Nothing may overflow sideways; a horizontally scrolling phone page
    // reads as broken.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('a door tap navigates', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[data-id="photographer"]').tap();
    await expect(page).toHaveURL(/\/photographer\/?$/);
  });
});

test.describe('mobile — photographer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/photographer/');
  });

  test('the wall lays out without sideways overflow', async ({ page }) => {
    await expect.poll(() => resultCount(page), { timeout: 20_000 }).toBeGreaterThan(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('the category filter opens as a sheet and closes from its header', async ({
    page,
  }) => {
    const trigger = page.locator('button[aria-haspopup="listbox"]').first();
    await trigger.tap();

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    // The sheet header's close button only matters on phone — desktop
    // dismisses by clicking outside, which a touch device cannot do
    // while a backdrop covers the page.
    await listbox.getByRole('button', { name: 'Close' }).tap();
    await expect(listbox).toBeHidden();
  });

  test('a tile tap opens the viewer and Close dismisses it', async ({ page }) => {
    const tiles = page.getByRole('button').filter({ has: page.locator('img') });
    await expect.poll(() => tiles.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await tiles.first().tap();

    const viewer = page.getByRole('dialog', { name: /Media viewer/ });
    await expect(viewer).toBeVisible();
    // Touch has no hover, so the viewer's chrome must be reachable
    // without a pointer-move to wake it.
    await viewer.getByRole('button', { name: 'Close' }).tap();
    await expect(viewer).toBeHidden();
  });

  test('swiping the viewer moves to the next photo', async ({ page }) => {
    const tiles = page.getByRole('button').filter({ has: page.locator('img') });
    await expect.poll(() => tiles.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await tiles.first().tap();

    const viewer = page.getByRole('dialog', { name: /Media viewer/ });
    await expect(viewer).toBeVisible();
    const counter = viewer.getByText(/^\d+ \/ \d+$/);
    const at = async () => Number((await counter.innerText()).split('/')[0]!.trim());
    const start = await at();

    // The track is a scroll-snap carousel, so a swipe is a scroll.
    const box = (await viewer.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.wheel(600, 0);
    await expect.poll(at, { timeout: 15_000 }).not.toBe(start);
  });
});

test.describe('mobile — explorer', () => {
  test('shows the globe or says why it cannot', async ({ page }) => {
    await page.goto('/explorer/');
    // On a phone the title plate is the only instruction a visitor gets,
    // and it must survive until they actually interact.
    await expect(page.getByText(/tap any country/i)).toBeVisible();
  });
});
