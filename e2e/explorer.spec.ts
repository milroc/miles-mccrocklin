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

  test('the globe replaces the loading state', async ({ page }) => {
    await requireLiveGlobe(page);
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('the pre-WebGL state shows a wireframe and says "loading"', async ({ page }) => {
    // Held open on purpose. LoadingGlobe is rendered unconditionally, so
    // asserting the label is merely *attached* can never fail — it says
    // nothing about whether the visitor ever sees it. Stalling the
    // topology fetch puts the page in the state this is about.
    await page.route('**/world-countries-*.topo.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      await route.continue();
    });
    await page.goto('/explorer/');

    await expect(page.getByText('loading')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    // The wireframe is the visual during the wait — not a blank screen.
    await expect(page.locator('[data-globe-failed]')).toHaveCount(0);
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

// Its own describe so the clock is installed before this page's only
// navigation. Sharing the outer beforeEach meant installing a clock onto
// an already-loaded page and then navigating again, which raced.
test.describe('explorer — idle chrome', () => {
  test('the chrome hides after exactly the idle delay, and returns on activity', async ({
    page,
  }) => {
    // A virtual clock, so this asserts the 3s contract from both sides
    // rather than "eventually, within 30s". Wall-clock timing here is
    // hopeless — several software-WebGL globes rendering in parallel
    // push a setTimeout out by seconds, which is why the previous
    // version needed a 30s timeout and passed happily with the delay
    // set to 250ms.
    await page.clock.install();
    await page.goto('/explorer/');

    const title = page.locator('p', { hasText: /Explorer · \d+ countries/ });
    await expect(title).toHaveAttribute('aria-hidden', 'false');

    await page.clock.runFor(2_500);
    await expect(title, 'still shown before the delay elapses')
      .toHaveAttribute('aria-hidden', 'false');

    await page.clock.runFor(1_000);
    await expect(title, 'hidden once the delay elapses')
      .toHaveAttribute('aria-hidden', 'true');

    await page.mouse.move(500, 400);
    await expect(title, 'cursor activity brings it back')
      .toHaveAttribute('aria-hidden', 'false');
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
    const name = await openCountry(page);
    await expect.poll(() => new URL(page.url()).searchParams.get('country'), {
      timeout: 10_000,
    }).toBeTruthy();

    // Shareable means the link reopens the same country, not merely that
    // some parameter appeared. Asserting non-empty would pass on a URL
    // that names the wrong place.
    const shared = page.url();
    await page.goto(shared);
    await requireLiveGlobe(page);
    await expect(page.getByRole('complementary', { name })).toBeVisible({
      timeout: 30_000,
    });
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
    // Antarctica is first in the index and carries four albums, so this
    // asserts rather than hunts. Selected structurally: the visible
    // "VIEW ALBUM →" text sits inside an aria-hidden span, so the
    // accessible name is just the album title and a /album/i role query
    // matches nothing (see issue #80). That is exactly why this spec
    // used to skip on every run with 35 countries' link hygiene
    // uncovered — never select these by name.
    await page.goto('/explorer/?country=ata');
    await requireLiveGlobe(page);
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible({ timeout: 30_000 });

    const albums = panel.locator('a[href^="https://"]');
    await expect(albums, 'Antarctica carries album links').not.toHaveCount(0);
    for (const link of await albums.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }
  });
});

test.describe('explorer — deep links', () => {
  test('?country= opens that country on load', async ({ page }) => {
    await page.goto('/explorer/?country=usa');
    await requireLiveGlobe(page);
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
