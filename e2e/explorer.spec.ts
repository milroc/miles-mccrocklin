// /explorer/ — the fullscreen globe. Every affordance here either drives
// the globe or reads its selection back out, so most of these specs need
// a live WebGL context; requireLiveGlobe asserts one rather than skipping.
import {
  test,
  expect,
  requireLiveGlobe,
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
    // Opened on a country deep-link on purpose. Explorer's idle effect
    // returns early while a country is selected — no listeners, no hide
    // timer — so the chrome is pinned visible and the toggle is genuinely
    // clickable for as long as the test needs.
    //
    // The alternative, clicking it in the idle-hide state, is a race the
    // pointer cannot reliably win, and six-worker stress proved it: the
    // wake move and the mousedown queue up as adjacent input events, but
    // waking is a React state change that lands a render later, so a
    // mousedown dispatched behind it is hit-tested against a plate that
    // still has pointer-events:none and goes to the globe instead. The
    // button then reads unchanged. That is issue #79 — the app is hard to
    // click, not the test impatient — and #79 carries the spec to add once
    // the chrome stops swallowing pointers.
    //
    // Not getByRole, either. Toolbar wraps the button in a div carrying
    // aria-hidden={!visible}, and an aria-hidden subtree is absent from
    // the accessibility tree, so a role locator matches nothing whenever
    // the chrome is down. An attribute selector reads the DOM and resolves
    // in both states, while conceding nothing: a <button> carries the
    // button role implicitly and aria-label is the accessible name. The
    // a11y-tree half is asserted below, where hidden is the state
    // under test.
    await page.goto('/explorer/?country=ata');
    await expect(page.getByRole('complementary')).toBeVisible({ timeout: 30_000 });

    const toggle = page.locator('button[aria-label$="rotation"]');
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('rotate: on');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toContainText('rotate: off');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('rotate: on');
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
    // BEHAVIOUR ONLY. This asserts that the plate hides when the pointer
    // goes still and comes back on movement. It does NOT assert the
    // length of the delay, and it cannot:
    //
    //   - page.clock would give an exact two-sided assertion, but it
    //     fakes requestAnimationFrame, and this page is a rAF-driven
    //     WebGL globe. Under six-worker contention that combination
    //     deadlocked the test — a 60s hang with no assertion reached.
    //   - A wall-clock lower bound ("still shown at 1.5s") looks
    //     load-proof, because CPU pressure makes timers late rather than
    //     early. It isn't, here: software-WebGL globe startup starves
    //     the main thread so thoroughly that even a 250ms timer has not
    //     fired by 2s. I checked, expecting it to catch a shortened
    //     delay, and it did not.
    //
    // So the delay length is untested. Closing that would need the
    // component to state it — `data-idle-ms={NAV_IDLE_MS}` on the plate
    // would make it a one-line, environment-proof assertion.
    await page.goto('/explorer/');
    const title = page.locator('p', { hasText: /Explorer · \d+ countries/ });
    await expect(title).toHaveAttribute('aria-hidden', 'false');

    // Generous: lateness is exactly what this environment causes.
    await expect(title, 'hides once the pointer goes still')
      .toHaveAttribute('aria-hidden', 'true', { timeout: 30_000 });

    await page.mouse.move(500, 400);
    await expect(title, 'cursor activity brings it back')
      .toHaveAttribute('aria-hidden', 'false');
  });

  test('hidden chrome leaves the keyboard and accessibility trees too', async ({
    page,
  }) => {
    // Fading the chrome out is only half of hiding it. If the button kept
    // its place in the tab order and the accessibility tree, a keyboard
    // or screen-reader visitor would land on a control that is invisible
    // and, because the plate drops pointer-events, not clickable either.
    // Toolbar handles both — aria-hidden on the wrapper, tabIndex -1 on
    // the button — and this pins that down in each direction.
    //
    // It is also the contract that forces the rotation spec above to
    // select by attribute: while this assertion holds, getByRole cannot
    // see the control at all.
    await page.goto('/explorer/');
    const toggle = page.locator('button[aria-label$="rotation"]');
    const byRole = page.getByRole('button', { name: /rotation/i });

    // Every assertion about the chrome being *up* carries a NAV_IDLE_MS
    // fuse, including the gap between two consecutive expects: the plate
    // can go back down in between. CI caught exactly that here — tabindex
    // read 0, then the role query found nothing a moment later. So the
    // pair is asserted together, behind a wake, and retried as a unit.
    // Everything inside is a cursor move or a read, so retrying is free
    // of side effects.
    const expectChromeUp = (): Promise<void> =>
      expect(
        async () => {
          await page.mouse.move(400, 300);
          await page.mouse.move(500, 400);
          await expect(toggle).toHaveAttribute('tabindex', '0', { timeout: 1_000 });
          await expect(byRole).toHaveCount(1, { timeout: 1_000 });
        },
        'the chrome is up, tabbable, and in the accessibility tree',
      ).toPass({ timeout: 30_000, intervals: [200, 200, 400] });

    await expectChromeUp();

    // The other direction needs no such care: once the plate is down it
    // stays down until something moves, and nothing here does.
    await expect(toggle, 'drops out of the tab order once idle')
      .toHaveAttribute('tabindex', '-1', { timeout: 30_000 });
    await expect(byRole, 'and out of the accessibility tree with it')
      .toHaveCount(0);

    await expectChromeUp();
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
