// Keyboard reachability across every page. Not an accessibility audit —
// it checks the specific promises this site makes: that every pillar can
// be operated without a pointer, that focus is always visible somewhere,
// and that no page traps a Tab.
import { test, expect, requireLiveGlobe } from './fixtures';

const PAGES = ['/', '/builder/', '/photographer/', '/resume/'];

test.describe('keyboard', () => {
  for (const path of PAGES) {
    test(`${path} moves focus forward through its controls`, async ({ page }) => {
      await page.goto(path);
      const seen: string[] = [];

      for (let i = 0; i < 15; i++) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const label =
            el.getAttribute('aria-label') ??
            el.textContent?.trim().slice(0, 40) ??
            el.tagName;
          return `${el.tagName}:${label}`;
        });
        if (focused) seen.push(focused);
      }

      // Fifteen tabs on any of these pages should land on real controls.
      expect(seen.length, `${path} had focusable controls`).toBeGreaterThan(3);
      // And it must not park on the same control forever.
      expect(new Set(seen).size, `${path} focus advanced`).toBeGreaterThan(2);
    });
  }

  test('the photography filters are fully operable from the keyboard', async ({
    page,
  }) => {
    await page.goto('/photographer/');
    const trigger = page.locator('button[aria-haspopup="listbox"]').first();

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();

    // Opening moves focus into the panel's own search box, so the panel
    // is operable from the keyboard the moment it appears.
    await expect(page.getByRole('listbox').getByRole('searchbox')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
  });

  // KNOWN GAP (issue #80): once focus is inside an open filter dropdown,
  // Escape unmounts the panel and focus falls to <body> rather than
  // returning to the trigger. A keyboard visitor who opens a filter,
  // changes their mind and presses Escape is sent to the top of the
  // document. WAI-ARIA's dismissal pattern asks for focus to return to
  // the control that opened the popup.
  //
  // The wait below is what makes this deterministic. TreeDropdown moves
  // focus into the panel from a requestAnimationFrame, so pressing
  // Escape immediately after opening is a race: win it and focus never
  // left the trigger and the bug doesn't reproduce. Waiting for the
  // searchbox first puts us in the state a real visitor is always in by
  // the time they react.
  //
  // test.fail, not test.fixme: this runs, and is expected to fail. A
  // skip would sit in the output forever without checking anything. The
  // day the bug is fixed, Playwright reports "expected to fail but
  // passed" and whoever fixed it deletes the annotation.
  test('Escape returns focus to the dropdown trigger', async ({ page }) => {
    // Inside the body, not at describe scope — a bare test.fail() there
    // would apply to every test in the file.
    test.fail();
    await page.goto('/photographer/');
    const trigger = page.locator('button[aria-haspopup="listbox"]').first();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole('searchbox')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the photography wall opens a photo from the keyboard', async ({ page }) => {
    await page.goto('/photographer/');
    const tiles = page.getByRole('button').filter({ has: page.locator('img') });
    await expect.poll(() => tiles.count(), { timeout: 20_000 }).toBeGreaterThan(0);

    await tiles.first().press('Enter');
    await expect(page.getByRole('dialog', { name: /Media viewer/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Media viewer/ })).toBeHidden();
  });

  test('the explorer is operable without a pointer at all', async ({ page }) => {
    await page.goto('/explorer/');
    // requireLiveGlobe distinguishes "no WebGL here" from "the globe
    // mounted but never handed its country set back" — the second is a
    // real regression, and the previous catch-all swallowed it into a
    // skip after burning 30s.
    await requireLiveGlobe(page);
    const buttons = page
      .getByRole('navigation', { name: 'Countries' })
      .getByRole('button');
    await expect.poll(() => buttons.count(), { timeout: 30_000 }).toBeGreaterThan(0);

    // The country index is the pointer-free path into the globe, and the
    // panel it opens closes with Escape.
    await buttons.first().press('Enter');
    await expect(page.getByRole('complementary')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary')).toBeHidden();
  });

  test('every page exposes exactly one h1', async ({ page }) => {
    for (const path of ['/', '/builder/', '/resume/']) {
      await page.goto(path);
      const count = await page.getByRole('heading', { level: 1 }).count();
      expect(count, `${path} has one h1`).toBe(1);
    }
  });

  // KNOWN GAP (issue #80): /photographer/ renders no headings at all —
  // not merely no h1. Its editorial intro ("I shoot wildlife, landscape,
  // and culture…") is a <p>, so a screen-reader visitor gets no document
  // outline, and heading navigation — one of the primary ways screen
  // readers move through a page — finds nothing.
  //
  // test.fail: see the note above. Delete the annotation when the page
  // grows a heading.
  test('/photographer/ exposes a heading', async ({ page }) => {
    test.fail();
    await page.goto('/photographer/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('every image carries an alt attribute', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      const missing = await page.evaluate(() =>
        [...document.querySelectorAll('img')]
          .filter((img) => !img.hasAttribute('alt'))
          .map((img) => img.getAttribute('src') ?? '(no src)'),
      );
      // Decorative images use alt="" — the failure being caught is an
      // image with no alt attribute at all, which screen readers read
      // out as its filename.
      expect(missing, `${path} images without alt`).toEqual([]);
    }
  });
});
