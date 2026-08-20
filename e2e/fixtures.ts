// Shared fixtures and page helpers for the e2e suite.
//
// Two things every spec wants and neither Playwright nor the app gives
// for free: a page that fails the test when the console logs an error,
// and a way to wait for the WebGL globe to reach a settled state instead
// of sleeping.

import {
  test as base,
  expect,
  type ConsoleMessage,
  type Locator,
  type Page,
} from '@playwright/test';

// Console noise the app does not own and cannot silence. Anything else
// reaching console.error fails the test that provoked it.
const IGNORED_CONSOLE = [
  // Chromium's own note about the <iframe> allow/allowfullscreen pair
  // that YouTube embeds ship with.
  /Allow attribute will take precedence over 'allowfullscreen'/,
  // Headless Chromium has no GPU; the software path still renders.
  /Automatic fallback to software WebGL has been deprecated/,
  /GroupMarkerNotSet|SwiftShader|Failed to create GLES3 context/,
];

function isIgnored(message: ConsoleMessage): boolean {
  const text = message.text();
  return IGNORED_CONSOLE.some((pattern) => pattern.test(text));
}

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && !isIgnored(message)) {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await use(errors);
    expect(errors, 'console errors during this test').toEqual([]);
  },
});

export { expect };

// ─── Globe ────────────────────────────────────────────────────────────

// The globe mount settles into exactly one of two states, and both are
// product behaviour worth asserting: a live WebGL canvas, or the
// documented failure note. Returns whichever happened so a spec can
// branch (or insist on one).
export type GlobeState = 'live' | 'webgl' | 'load';

export async function waitForGlobe(page: Page): Promise<GlobeState> {
  const handle = await page.waitForFunction(
    () => {
      const failed = document.querySelector('[data-globe-failed]');
      if (failed) return failed.getAttribute('data-globe-failed');
      const box = document.querySelector('[data-splash-globe-box]');
      if (box?.getAttribute('data-live') === 'true') return 'live';
      return document.querySelector('canvas') ? 'live' : null;
    },
    undefined,
    { timeout: 45_000 },
  );
  const state = await handle.jsonValue();
  return state === 'webgl' || state === 'load' ? state : 'live';
}

// Insist on the real thing. Skips rather than fails when the runner has
// no working WebGL, so a GPU-less environment reports honestly instead
// of turning every globe assertion red.
export async function requireLiveGlobe(page: Page): Promise<void> {
  const state = await waitForGlobe(page);
  test.skip(state !== 'live', `globe unavailable in this environment (${state})`);
}

// Two surfaces deliberately hide their chrome when the pointer goes
// still — Explorer's nav/toolbar/title after 3s, the media viewer's
// topbar and arrows after 1.2s — and the hidden plate stops taking
// pointer events, so whatever is underneath (the globe canvas, the
// photo) receives the click instead.
//
// That means a pointer click on those controls only lands inside the
// window that cursor movement opens. Playwright's own retry loop does
// not help: it waits without moving the mouse, so the chrome hides
// under it and stays hidden. This wakes the chrome and clicks as one
// gesture, retrying the gesture rather than the click.
//
// Keyboard paths need none of this, which is the point of testing both.
export async function clickIdleChrome(page: Page, locator: Locator): Promise<void> {
  // Settle the element once, outside the timed gesture — on a loaded
  // machine Playwright's own visible/enabled/stable wait can eat the
  // whole window before it even tries to click.
  await expect(locator).toBeAttached();
  await expect(async () => {
    await page.mouse.move(400, 300);
    await page.mouse.move(404, 304);
    await locator.click({ timeout: 2_500, force: false });
  }).toPass({ timeout: 40_000, intervals: [250, 250, 500] });
}

// ─── Filters ──────────────────────────────────────────────────────────

// The photography page keeps its filter state in the URL. Reading it
// back is how a spec checks that a click actually changed the model and
// not just the pixels.
export async function filterParams(page: Page): Promise<Record<string, string>> {
  const url = new URL(page.url());
  return Object.fromEntries(url.searchParams.entries());
}

// The "N photos" counter next to the filters, as a number.
export async function resultCount(page: Page): Promise<number> {
  const text = await page.getByText(/\d+ photos?$/).first().innerText();
  return Number(text.replace(/\D+/g, ''));
}
