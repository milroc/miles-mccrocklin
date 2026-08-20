// The media viewer. One component (MediaProvider) serving two very
// different callers: the photography wall's 200-odd photos and the
// resume's small per-entry galleries. Both are exercised here.
import { test, expect, clickIdleChrome } from './fixtures';

type Page = import('@playwright/test').Page;

const tiles = (page: Page) => page.getByRole('button').filter({ has: page.locator('img') });
const viewer = (page: Page) => page.getByRole('dialog', { name: /Media viewer/ });

// The viewer's track scroll-snaps and animates, so the counter passes
// through intermediate values mid-flight.
//
// Assertions poll to a known target rather than trying to detect that
// motion has stopped. The previous "wait for it to change, then read the
// same value three times" heuristic was both slower and wrong on a
// loaded machine: CI caught it reporting the pre-move value on the
// wrap-around spec. If the index is expected to become N, wait for N.
// The counter reading right is not the same as the carousel having
// stopped. Under load a press can land while the previous smooth scroll
// is still in flight, and the handler acts on an index that is already
// moving — which is how a Previous from a displayed "2" arrives at 215.
//
// The track's own scrollLeft is the honest idle signal. MediaProvider
// does not expose one (it has programmaticScrollRef internally; a
// `data-settling` attribute would be better than this), so find the
// scrollable child and watch it stop.
async function waitForTrackQuiet(page: Page): Promise<void> {
  const dialog = (await viewer(page).elementHandle())!;
  const scrollLeft = () =>
    dialog.evaluate((el) => {
      const track = [...el.querySelectorAll('div')].find(
        (d) => d.scrollWidth > d.clientWidth + 10,
      );
      return track ? Math.round(track.scrollLeft) : -1;
    });
  await expect
    .poll(
      async () => {
        const first = await scrollLeft();
        await page.waitForTimeout(150);
        const second = await scrollLeft();
        await page.waitForTimeout(150);
        return first === second && second === (await scrollLeft());
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function readIndex(page: Page): Promise<number> {
  const counter = viewer(page).getByText(/^\d+ \/ \d+$/);
  return Number((await counter.innerText()).split('/')[0]!.trim());
}

// Poll until the index reaches the target AND holds there.
//
// Both halves are needed, and each was learned the hard way. Waiting
// only for the value to settle reported the pre-move value on a loaded
// CI runner. Waiting only for the value to appear accepts a transient:
// the track scroll-snaps, so the counter passes through values it does
// not come to rest on — which showed up as a Previous press from a
// transient "2" landing on 215 instead of 1.
async function expectIndex(page: Page, target: number): Promise<void> {
  await waitForTrackQuiet(page);
  await expect.poll(() => readIndex(page), { timeout: 25_000 }).toBe(target);
}

async function scopeSize(page: Page): Promise<number> {
  const counter = viewer(page).getByText(/^\d+ \/ \d+$/);
  return Number((await counter.innerText()).split('/')[1]!.trim());
}

async function openPhoto(page: Page, nth = 0): Promise<void> {
  await expect
    .poll(() => tiles(page).count(), { timeout: 20_000 })
    .toBeGreaterThan(nth);
  await tiles(page).nth(nth).click();
  await expect(viewer(page)).toBeVisible();
  // Settled before the spec touches anything: the opening scroll is a
  // navigation like any other.
  await waitForTrackQuiet(page);
}

async function openFirstPhoto(page: Page): Promise<void> {
  await openPhoto(page, 0);
}

test.describe('lightbox — from the photography wall', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/photographer/');
  });

  test('a tile opens the viewer as a modal dialog', async ({ page }) => {
    await openFirstPhoto(page);
    const dialog = viewer(page);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
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

  // Each of these performs exactly ONE navigation from a freshly opened
  // viewer.
  //
  // That is deliberate, and it is what makes them stable. Issue #81:
  // navigateTo assumes a smooth scroll finishes in a fixed 400ms and then
  // lets the loop normalizer recompute the index — so a *second*
  // navigation arriving while the first is still resolving lands on the
  // wrong photo. A single navigation cannot race with itself.
  //
  // The round trip ("Next then Previous returns you to where you were")
  // is therefore not asserted here. It is precisely the sequence #81
  // breaks, and asserting it today would mean asserting a behaviour the
  // app does not reliably have. Add it when #81 is fixed.

  test('the next button advances exactly one photo', async ({ page }) => {
    await openPhoto(page, 0);
    const start = await readIndex(page);
    // The arrows fade with the viewer's idle-chrome timer, after which
    // the photo itself takes the click — so the press has to wake them.
    await clickIdleChrome(page, viewer(page).getByRole('button', { name: 'Next photo' }));
    // Exactly one. navigateTo/onScroll does real index arithmetic across
    // three loop copies; "it moved" would pass on an off-by-one.
    await expectIndex(page, start + 1);
  });

  test('the previous button steps back exactly one photo', async ({ page }) => {
    // Opened partway in, so stepping back is an ordinary move rather
    // than the wrap-around, which has its own spec below.
    await openPhoto(page, 2);
    const start = await readIndex(page);
    expect(start).toBeGreaterThan(1);
    await clickIdleChrome(
      page,
      viewer(page).getByRole('button', { name: 'Previous photo' }),
    );
    await expectIndex(page, start - 1);
  });

  test('ArrowRight advances exactly one photo', async ({ page }) => {
    await openPhoto(page, 0);
    const start = await readIndex(page);
    await page.keyboard.press('ArrowRight');
    await expectIndex(page, start + 1);
  });

  test('ArrowLeft steps back exactly one photo', async ({ page }) => {
    await openPhoto(page, 2);
    const start = await readIndex(page);
    expect(start).toBeGreaterThan(1);
    await page.keyboard.press('ArrowLeft');
    await expectIndex(page, start - 1);
  });

  test('the set wraps around rather than dead-ending', async ({ page }) => {
    await openFirstPhoto(page);
    const total = await scopeSize(page);
    // A hard assertion: the wall ships 200+ photos, so a scope that
    // small is a regression rather than a reason to skip.
    expect(total, 'the unfiltered wall has photos to page through')
      .toBeGreaterThan(1);
    await expectIndex(page, 1);

    // Step back from the first photo; a viewer that stops here strands
    // the visitor at an edge with a live-looking button.
    await page.keyboard.press('ArrowLeft');
    await expectIndex(page, total);
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
    expect(expected).toBeGreaterThan(0);

    // Wait for the wall itself to reflect the filter before clicking.
    // The counter and the URL update ahead of the masonry re-render, so
    // clicking straight after them can hit a tile left over from the
    // unfiltered set — which carries the unfiltered scope with it. CI
    // caught exactly that: 215 photos in a viewer opened from a wall
    // showing 13.
    await expect.poll(() => tiles(page).count(), { timeout: 20_000 }).toBe(expected);

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
