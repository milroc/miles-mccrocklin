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

      // aria-pressed is on the buttons themselves. filter({ has }) looks
      // for a *descendant*, so it counted zero every time and `0 <= 1`
      // could never fail.
      await expect(
        toolbar.locator('button[aria-pressed="true"]'),
        'exactly one mode is pressed',
      ).toHaveCount(1);
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

type Page = import('@playwright/test').Page;

// The Airbnb reviews sit behind *two* nested disclosures: the sabbatical
// entry collapses every track after the first, and the Reviews component
// is itself a <details> that starts closed. Nothing below either was
// reachable from a test until these existed.
async function openSabbatical(page: Page): Promise<void> {
  const more = page.getByRole('button', { name: /Learn more about my sabbatical/ });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole('button', { name: /Show less/ })).toBeVisible();
}

// Returns the reviews disclosure. Scoping to it matters: the resume
// page's own root is an <article>, so a bare getByRole('article') picks
// up the whole document alongside the five cards.
async function openReviews(page: Page) {
  await openSabbatical(page);
  const details = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: /guest reviews/ }) });
  await expect(details, 'the reviews disclosure is present').toBeVisible();
  await details.locator('summary').click();
  await expect(details.getByRole('article').first()).toBeVisible();
  return details;
}

test.describe('resume — content affordances', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/resume/');
  });

  test('redaction glyphs link to their note and back', async ({ page }) => {
    const glyph = page.getByRole('link', { name: /Redacted variable/ }).first();
    await expect(glyph, 'the resume carries redactions').toBeVisible();

    const href = await glyph.getAttribute('href');
    expect(href).toMatch(/^#note-/);
    await glyph.click();
    await expect(page.locator(href!)).toBeVisible();

    // Every note offers a way back to where the reader was.
    const back = page.getByRole('link', { name: /Back to the text/i }).first();
    await expect(back).toHaveAttribute('href', /^#ref-/);
  });

  test('a review translates and reverts', async ({ page }) => {
    // This spec skipped on every run before, because the reviews are two
    // disclosures deep and nothing opened them — Track/Reviews/ReviewCard
    // had zero coverage. Assert the fixture exists rather than skipping
    // when it doesn't: the data is committed alongside the code.
    const details = await openReviews(page);
    const cards = details.getByRole('article');

    // Pin the card by position, not by the button inside it: the toggle
    // renames itself to "Show original" on click, so a locator chained
    // off its name stops resolving the moment it is used.
    const total = await cards.count();
    let index = -1;
    for (let i = 0; i < total; i++) {
      const has = await cards
        .nth(i)
        .getByRole('button', { name: /Translate to English/ })
        .count();
      if (has > 0) {
        index = i;
        break;
      }
    }
    expect(index, 'a translated review is present in me.json').toBeGreaterThanOrEqual(0);

    const card = cards.nth(index);
    const original = await card.innerText();

    await card.getByRole('button', { name: /Translate to English/ }).click();
    await expect(card.getByRole('button', { name: /Show original/ })).toBeVisible();
    await expect.poll(() => card.innerText()).not.toBe(original);

    await card.getByRole('button', { name: /Show original/ }).click();
    await expect(card.getByRole('button', { name: /Translate to English/ })).toBeVisible();
    await expect.poll(() => card.innerText()).toBe(original);
  });

  test('the sabbatical disclosure reveals its tracks and closes again', async ({
    page,
  }) => {
    const more = page.locator('#sabbatical-more');
    await expect(more).toHaveCount(0);

    await openSabbatical(page);
    // The collapsed tracks — Real Estate, photography — live only here.
    await expect(more).toBeVisible();
    await expect(more).toContainText(/real estate investor/i);

    await page.getByRole('button', { name: /Show less/ }).click();
    await expect(more).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Learn more about my sabbatical/ }))
      .toBeVisible();
  });

  test('the reviews disclosure expands and collapses', async ({ page }) => {
    const details = await openReviews(page);
    const cards = details.getByRole('article');
    await expect.poll(() => cards.count()).toBeGreaterThan(1);
    // Every card states its rating to screen readers, not just as stars.
    await expect(cards).toHaveCount(
      await details.getByRole('img', { name: /out of 5/ }).count(),
    );

    await details.getByRole('button', { name: 'collapse' }).click();
    await expect(cards.first()).toBeHidden();
  });

  test('the reviews link out to the Airbnb listing', async ({ page }) => {
    const details = await openReviews(page);
    const link = details.getByRole('link', { name: /See all .* reviews on Airbnb/ });
    await expect(link).toHaveAttribute('href', /^https?:/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noreferrer/);
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
    await expect(header.getByRole('link')).not.toHaveCount(0);
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
    await expect(figures, 'the builder page carries media cards').not.toHaveCount(0);
    await figures.first().click();
    await expect(page.getByRole('dialog', { name: /Media viewer/ })).toBeVisible();
  });
});
