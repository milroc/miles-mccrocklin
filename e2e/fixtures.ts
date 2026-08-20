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
  // Chromium's own notes about the <iframe> that YouTube embeds ship
  // with: the allow/allowfullscreen pair, and the player asking for a
  // Compute Pressure permission this document does not delegate.
  // Neither is under this site's control, and neither indicates a fault.
  /Allow attribute will take precedence over 'allowfullscreen'/,
  /^Permissions policy violation: compute-pressure is not allowed/,
  // Headless Chromium has no GPU; the software path still renders.
  /Automatic fallback to software WebGL has been deprecated/,
  // Anchored to Chromium's own prefixes. An unanchored /SwiftShader/
  // would also swallow anything the app logged about its renderer —
  // `gl.getParameter(RENDERER)` reads "SwiftShader Device" here.
  /^\[\.WebGL[^\]]*\]/,
  /^GroupMarkerNotSet/,
  /^Failed to create GLES3 context/,
];

function isIgnored(message: ConsoleMessage): boolean {
  const text = message.text();
  return IGNORED_CONSOLE.some((pattern) => pattern.test(text));
}

// `auto: true` is load-bearing: Playwright only builds a fixture a test
// asks for by name, and no spec asks for this one. Without it the
// listeners below are never attached and the guarantee is imaginary.
export const test = base.extend<{
  consoleErrors: string[];
  // Per-spec escape hatch, declared with test.use() at the one place it
  // applies. A spec that navigates to a page which is *itself* an error
  // response gets Chromium's own network log for it; that is expected,
  // and allowlisting it globally would hide every genuinely missing
  // asset on every other page.
  expectedConsoleErrors: RegExp[];
}>({
  expectedConsoleErrors: [[], { option: true }],

  consoleErrors: [async ({ page, expectedConsoleErrors }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() !== 'error') return;
      if (isIgnored(message)) return;
      if (expectedConsoleErrors.some((pattern) => pattern.test(text))) return;
      errors.push(text);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await use(errors);
    expect(errors, 'console errors during this test').toEqual([]);
  }, { auto: true }],
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

// Insist on the real thing, everywhere.
//
// This used to skip when WebGL was missing, on the theory that a
// GPU-less machine should report honestly rather than turn every globe
// assertion red. That theory was wrong twice over. playwright.config.ts
// forces software rendering (--use-angle=swiftshader), which needs no
// GPU at all — and across every local run and every CI run on
// ubuntu-latest, the skip branch has never once been taken. It was dead
// weight guarding a case that does not arise, and dead weight that could
// silently turn thirteen specs into no-ops behind a green check.
//
// So: a hard assertion, with a message that says what to do about it.
export async function requireLiveGlobe(page: Page): Promise<void> {
  const state = await waitForGlobe(page);
  expect(
    state,
    'the globe never reached its live WebGL state. Software rendering is ' +
      'forced in playwright.config.ts, so this means the browser or its ' +
      'system libraries are broken rather than that the machine lacks a ' +
      'GPU — try `bunx playwright install --with-deps chromium`.',
  ).toBe('live');
}

// The media viewer hides its topbar and arrows 1.2s after the pointer
// goes still, and the hidden plate stops taking pointer events, so the
// photo underneath receives the click instead.
//
// Explorer does the same to its nav, toolbar and title after 3s, but is
// no longer driven through here: its chrome sits under a starving WebGL
// globe, which stretched the gap between waking the plate and pressing
// it far enough that presses were swallowed outright. explorer.spec.ts
// pins the chrome open with a country deep-link instead, and issue #79
// tracks the underlying "faded plates are hard to click".
//
// That means a pointer click on those controls only lands inside the
// window that cursor movement opens. Playwright's own retry loop does
// not help: it waits without moving the mouse, so the chrome hides
// under it and stays hidden.
//
// Only the idempotent half is retried. An earlier version retried the
// click too, which is unsafe: a click that *lands* but whose internal
// wait exceeds the timeout gets retried and applies the action twice.
// CI caught it — two "Previous photo" presses from index 2 arrived at
// 215 — and it would silently double any action taken this way.
//
// pointer-events inherits, so a button inside a faded plate computes to
// `none`; waiting for `auto` is waiting for the chrome to be genuinely
// interactive again rather than merely present.
//
// Keyboard paths need none of this, which is the point of testing both.
//
// Pass a locator that reads the DOM — an attribute or data-* selector —
// never getByRole. Explorer's chrome sets aria-hidden on the wrapper
// while hidden, which removes its controls from the accessibility tree,
// so a role locator matches nothing in exactly the state this helper
// exists to recover from. (The media viewer hides its chrome with a
// class instead, so role locators are safe there.)
export async function clickIdleChrome(page: Page, locator: Locator): Promise<void> {
  // The default 10s expect timeout is a deadline on this page's boot,
  // not on the control: Explorer ships three.js and a topology fetch, and
  // a two-core runner can still be executing that when the first
  // assertion runs. Every other wait on this page is budgeted at 30s.
  await expect(locator, 'the page rendered its chrome').toBeAttached({
    timeout: 30_000,
  });

  // Wake the chrome and take the control's position. Everything in here
  // is a cursor move or a style read, so retrying is free of side
  // effects.
  let box: { x: number; y: number; width: number; height: number } | null = null;
  await expect(
    async () => {
      await page.mouse.move(400, 300);
      const current = await locator.boundingBox();
      expect(current, 'the control has a box to click').not.toBeNull();
      await page.mouse.move(
        current!.x + current!.width / 2,
        current!.y + current!.height / 2,
      );
      await expect(locator).toHaveCSS('pointer-events', 'auto', { timeout: 1_000 });
      box = current;
    },
    'waking idle-hidden chrome so it accepts a pointer again',
  ).toPass({ timeout: 30_000, intervals: [200, 200, 400] });

  // Raw mouse events rather than locator.click(). Playwright's click runs
  // an actionability wait first, and that wait can outlive the idle
  // window — the chrome hides underneath it and the click never lands.
  //
  // Two moves at distinct coordinates, because Chromium fires no
  // mousemove for a move to the position the cursor already occupies, and
  // a move that fires no mousemove wakes nothing. Then confirm the plate
  // is taking pointers again and press straight away: waking is a React
  // state change that lands a render later, so a mousedown dispatched
  // behind an unrendered wake is hit-tested against pointer-events:none
  // and goes to whatever sits underneath. Explorer demonstrated exactly
  // that under six-worker stress, which is why it no longer uses this
  // helper at all. Confirming immediately before the press is what keeps
  // the remaining window down to a single round trip.
  const target = box!;
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  await page.mouse.move(cx - 2, cy - 2);
  await page.mouse.move(cx, cy);
  await expect(locator, 'still taking pointers at the moment of the press')
    .toHaveCSS('pointer-events', 'auto', { timeout: 5_000 });
  await page.mouse.down();
  await page.mouse.up();
}

// A link click starts a full document navigation, and expect's 10s
// default then measures how fast the destination loads rather than
// whether the link works. /photographer/ inlines a 215-photo manifest
// and /explorer/ ships three.js; on a two-core runner either can outrun
// 10s, which is what failed CI on `mobile — a door tap navigates` with
// the URL still empty and the navigation reported as unfinished.
//
// page.goto() gets Playwright's 30s navigation budget everywhere else in
// this suite, so a click-driven navigation gets the same one. This is a
// deadline on arriving at all, not on arriving quickly — nothing here
// claims a page-load budget, and a spec that quietly did would be
// asserting the runner's speed.
export const NAV_TIMEOUT = 30_000;

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
