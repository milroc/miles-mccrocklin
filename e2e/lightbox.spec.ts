// The media viewer. One component (MediaProvider) serving two very
// different callers: the photography wall's 200-odd photos and the
// resume's small per-entry galleries. Both are exercised here.
import { test, expect, clickIdleChrome } from './fixtures';

type Page = import('@playwright/test').Page;

const tiles = (page: Page) => page.getByRole('button').filter({ has: page.locator('img') });
const viewer = (page: Page) => page.getByRole('dialog', { name: /Media viewer/ });

// The viewer's track scroll-snaps and animates, so the counter can pass
// through an intermediate value mid-flight. Everything here reads the
// index only once it has stopped moving.
//
// `changedFrom` waits for the move to begin before waiting for it to
// end; without it a slow machine can be sampled three times before the
// scroll has even started and report "settled" on the old value.
async function settledIndex(page: Page, changedFrom?: number): Promise<number> {
  const counter = viewer(page).getByText(/^\d+ \/ \d+$/);
  const read = async () => Number((await counter.innerText()).split('/')[0]!.trim());

  if (changedFrom !== undefined) {
    await expect.poll(read, { timeout: 20_000 }).not.toBe(changedFrom);
  }
  let last = await read();
  let stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    await page.waitForTimeout(100);
    const now = await read();
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return last;
}

async function scopeSize(page: Page): Promise<number> {
  const counter = viewer(page).getByText(/^\d+ \/ \d+$/);
  return Number((await counter.innerText()).split('/')[1]!.trim());
}

async function openFirstPhoto(page: Page): Promise<void> {
  await expect.poll(() => tiles(page).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await tiles(page).first().click();
  await expect(viewer(page)).toBeVisible();
}

test.describe('lightbox — from the photography wall', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/photographer/');
  });

  test('a tile opens the viewer as a modal dialog', async ({ page }) => {
    await openFirstPhoto(page);
    const dialog = viewer(page);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeAttached();
    // The counter is how a visitor knows where they are in the set.
    await expect(dialog.getByText(/^\d+ \/ \d+$/)).toBeVisible();
  });

  test('the close button dismisses it', async ({ page }) => {
    await openFirstPhoto(page);
    await clickIdleChrome(page, viewer(page).getByRole('button', { name: 'Close' }));
    await expect(viewer(page)).toBeHidden();
  });

  test('Escape dismisses it', async ({ page }) => {
    await openFirstPhoto(page);
    await page.keyboard.press('Escape');
    await expect(viewer(page)).toBeHidden();
  });

  test('the next and previous buttons move through the set', async ({ page }) => {
    await openFirstPhoto(page);
    const start = await settledIndex(page);

    // The arrows fade with the viewer's idle-chrome timer, after which
    // the photo itself takes the click — so each press has to wake them.
    await clickIdleChrome(page, viewer(page).getByRole('button', { name: 'Next photo' }));
    const next = await settledIndex(page, start);
    expect(next).not.toBe(start);

    await clickIdleChrome(
      page,
      viewer(page).getByRole('button', { name: 'Previous photo' }),
    );
    expect(await settledIndex(page, next)).toBe(start);
  });

  test('the arrow keys move through the set', async ({ page }) => {
    await openFirstPhoto(page);
    const start = await settledIndex(page);

    await page.keyboard.press('ArrowRight');
    const next = await settledIndex(page, start);
    expect(next).not.toBe(start);

    await page.keyboard.press('ArrowLeft');
    expect(await settledIndex(page, next)).toBe(start);
  });

  test('the set wraps around rather than dead-ending', async ({ page }) => {
    await openFirstPhoto(page);
    const total = await scopeSize(page);
    test.skip(total < 2, 'needs more than one photo in scope');
    expect(await settledIndex(page)).toBe(1);

    // Step back from the first photo; a viewer that stops here strands
    // the visitor at an edge with a live-looking button.
    await page.keyboard.press('ArrowLeft');
    expect(await settledIndex(page, 1)).toBe(total);
  });

  test('focus is trapped inside the dialog and returns on close', async ({ page }) => {
    await expect.poll(() => tiles(page).count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const opener = tiles(page).first();
    await opener.click();
    await expect(viewer(page)).toBeVisible();

    // Tab a full lap; focus must never escape to the page behind.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return !!dialog && !!document.activeElement && dialog.contains(document.activeElement);
      });
      expect(inside, `focus stayed in the dialog after ${i + 1} tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(viewer(page)).toBeHidden();
    // Closing has to hand focus back to what opened it, or a keyboard
    // visitor restarts from the top of the page.
    await expect(opener).toBeFocused();
  });

  test('the page behind does not scroll while the viewer is open', async ({ page }) => {
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await openFirstPhoto(page);

    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
    // Scrolling the wall out from under an open photo loses the
    // visitor's place the moment they close it.
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });

  test('a filtered wall scopes the viewer to the results', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search photos' }).fill('penguin');
    await expect.poll(async () => new URL(page.url()).searchParams.get('q')).toBe(
      'penguin',
    );
    const shown = await page.getByText(/\d+ photos?$/).first().innerText();
    const expected = Number(shown.replace(/\D+/g, ''));

    await openFirstPhoto(page);
    const total = await scopeSize(page);
    // Opening a photo out of a filtered wall and then paging into photos
    // that were filtered out is the bug this guards.
    expect(total).toBe(expected);
  });
});

test.describe('lightbox — from the resume', () => {
  test('a figure opens the viewer and closes again', async ({ page }) => {
    await page.goto('/resume/');
    // data-figure-card is the attribute FigureCard exposes for exactly
    // this: finding a card without depending on a hashed class name.
    const figures = page.locator('[data-figure-card]:not([aria-hidden]):not([data-edge])');
    await expect.poll(() => figures.count(), { timeout: 20_000 }).toBeGreaterThan(0);

    await figures.first().click();
    await expect(viewer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer(page)).toBeHidden();
  });
});
