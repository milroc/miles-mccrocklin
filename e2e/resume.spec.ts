// /resume/ — the detailed resume. Three render modes, a print path,
// redaction cross-references, review translation, and the terminal dock.
import { test, expect } from './fixtures';

// Counter the print spec installs in the page. Declared rather than
// cast at each use so the three reads below stay honest about it.
declare global {
  interface Window {
    __printCount?: number;
  }
}

test.describe('resume — modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/resume/');
  });

  test('opens in the full interactive mode', async ({ page }) => {
    const toolbar = page.getByRole('navigation', { name: 'Resume controls' });
    await expect(toolbar.getByRole('button', { name: 'Full' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-app]')).toHaveClass(/mode-interactive/);
  });

  test('each mode button selects exactly one mode', async ({ page }) => {
    const toolbar = page.getByRole('navigation', { name: 'Resume controls' });
    for (const [label, mode] of [
      ['Text only', 'text'],
      ['1-Pager', '1pager'],
      ['Full', 'interactive'],
    ] as const) {
      await toolbar.getByRole('button', { name: label }).click();
      await expect(page.locator('[data-app]')).toHaveClass(new RegExp(`mode-${mode}`));

      const pressed = await toolbar
        .getByRole('button')
        .filter({ has: page.locator('[aria-pressed="true"]') })
        .count();
      expect(pressed, 'modes are mutually exclusive').toBeLessThanOrEqual(1);
      await expect(toolbar.getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
  });

  test('text mode drops the media and 1-pager trims further', async ({ page }) => {
    const figures = page.locator('[data-figure-card]');
    const full = await figures.count();
    expect(full).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Text only' }).click();
    await expect.poll(() => figures.count()).toBe(0);

    const textLength = (await page.locator('[data-app]').innerText()).length;
    await page.getByRole('button', { name: '1-Pager' }).click();
    await expect
      .poll(async () => (await page.locator('[data-app]').innerText()).length)
      .toBeLessThan(textLength);
  });

  test('the print button reaches the browser print dialog', async ({ page }) => {
    // window.print is stubbed because a real dialog would block the run.
    // What is being asserted is that the button is wired to it at all.
    await page.addInitScript(() => {
      window.__printCount = 0;
      window.print = () => {
        window.__printCount = (window.__printCount ?? 0) + 1;
      };
    });
    await page.reload();
    await page.getByRole('button', { name: /Print/ }).click();
    await expect.poll(() => page.evaluate(() => window.__printCount)).toBe(1);
  });

  test('the skip link jumps past the chrome', async ({ page }) => {
    const skip = page.getByRole('link', { name: /Skip to resume/i });
    await skip.focus();
    await expect(skip).toBeFocused();
    await skip.press('Enter');
    await expect(page).toHaveURL(/#resume-content$/);
    await expect(page.locator('#resume-content')).toBeVisible();
  });
});

test.describe('resume — content affordances', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/resume/');
  });

  test('redaction glyphs link to their note and back', async ({ page }) => {
    const glyph = page.getByRole('link', { name: /Redacted variable/ }).first();
    test.skip((await glyph.count()) === 0, 'no redactions in the current resume');

    const href = await glyph.getAttribute('href');
    expect(href).toMatch(/^#note-/);
    await glyph.click();
    await expect(page.locator(href!)).toBeVisible();

    // Every note offers a way back to where the reader was.
    const back = page.getByRole('link', { name: /Back to the text/i }).first();
    await expect(back).toHaveAttribute('href', /^#ref-/);
  });

  test('a review translates and reverts', async ({ page }) => {
    const translate = page.getByRole('button', { name: /Translate to English/ }).first();
    test.skip((await translate.count()) === 0, 'no translated reviews present');

    const card = translate.locator('xpath=ancestor::article[1]');
    const original = await card.innerText();

    await translate.click();
    await expect(card.getByRole('button', { name: /Show original/ })).toBeVisible();
    await expect.poll(() => card.innerText()).not.toBe(original);

    await card.getByRole('button', { name: /Show original/ }).click();
    await expect.poll(() => card.innerText()).toBe(original);
  });

  test('the terminal dock opens from the skills caption and closes', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /Show Claude Code terminal/ });
    // Located by attribute, not by role: while closed the dock carries
    // aria-hidden, which takes it out of the accessibility tree — which
    // is exactly the state being asserted.
    const dock = page.locator('[aria-label="Claude Code terminal preview"]');
    await expect(dock).toHaveAttribute('aria-hidden', 'true');

    await trigger.click();
    await expect(dock).toHaveAttribute('aria-hidden', 'false');

    await dock.getByRole('button', { name: 'Close' }).click();
    await expect(dock).toHaveAttribute('aria-hidden', 'true');
  });

  test('Escape also closes the terminal dock', async ({ page }) => {
    await page.getByRole('button', { name: /Show Claude Code terminal/ }).click();
    const dock = page.locator('[aria-label="Claude Code terminal preview"]');
    await expect(dock).toHaveAttribute('aria-hidden', 'false');

    await page.keyboard.press('Escape');
    await expect(dock).toHaveAttribute('aria-hidden', 'true');
  });

  test('contact links are real and off-site ones open in a new tab', async ({ page }) => {
    const header = page.locator('header').first();
    for (const link of await header.getByRole('link').all()) {
      const href = await link.getAttribute('href');
      expect(href, 'every contact link has a destination').toBeTruthy();
      if (/^https?:/.test(href!)) {
        await expect(link).toHaveAttribute('target', '_blank');
      }
    }
  });
});

test.describe('builder', () => {
  test('renders the prose page with its footer doors', async ({ page }) => {
    await page.goto('/builder/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    // The footer is how a visitor leaves this page for the other two
    // pillars; a builder page with no exits is a cul-de-sac.
    const doors = page.locator('footer').getByRole('link');
    await expect.poll(() => doors.count()).toBeGreaterThanOrEqual(2);
    const hrefs = await Promise.all(
      (await doors.all()).map((d) => d.getAttribute('href')),
    );
    expect(hrefs).toContain('/explorer/');
    expect(hrefs).toContain('/photographer/');
  });

  test('media on the builder page opens the viewer', async ({ page }) => {
    await page.goto('/builder/');
    // Two kinds of card are deliberately not lightbox triggers: the
    // carousel's loop clones (aria-hidden, tabIndex -1) and any card
    // sitting in the masked edge zone (data-edge), which centres itself
    // on click instead. Both are covered by their own specs.
    const figures = page.locator('[data-figure-card]:not([aria-hidden]):not([data-edge])');
    test.skip((await figures.count()) === 0, 'builder page has no media cards');
    await figures.first().click();
    await expect(page.getByRole('dialog', { name: /Media viewer/ })).toBeVisible();
  });
});
