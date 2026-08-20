import { defineConfig, devices } from '@playwright/test';

// Two servers, because the site has two meaningfully different builds.
//
//   4318 — dist/, the artifact that ships. Everything runs here.
//   4317 — `bun run dev`, the only build where EDIT_ENABLED is true.
//          Just the edit-mode specs.
//
// Both are started by Playwright and torn down after the run. Locally,
// an already-running server on either port is reused.
const DIST_PORT = 4318;
const DEV_PORT = 4317;

// Chromium needs to be told to bring a software GL stack, or the globe's
// WebGL probe fails and every globe spec exercises the fallback path
// instead of the real one. The suite asserts the fallback separately, by
// disabling WebGL on purpose.
const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

export default defineConfig({
  testDir: './e2e',
  // The globe specs wait on WebGL, texture drips and camera flights.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Software WebGL is the constraint, not CPU count: half a dozen globes
  // rendering at once starve each other's timers badly enough to make
  // idle-hide and scroll-snap assertions flaky. Four is comfortable on a
  // laptop; CI gets two.
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'prod',
      // The mobile and dev specs have their own projects below.
      testIgnore: [/\.dev\.spec\.ts$/, /\.mobile\.spec\.ts$/],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${DIST_PORT}`,
        launchOptions: { args: GL_ARGS },
      },
    },
    {
      // Phone profile: the iPhone 13's viewport, DPR and touch input, but
      // run on Chromium so the suite needs one browser download rather
      // than two. This project exists to cover the responsive branches
      // (the splash restack, the bottom-sheet filters, the masonry
      // column count), not to be a cross-engine matrix.
      name: 'mobile',
      testMatch: /\.mobile\.spec\.ts$/,
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        baseURL: `http://127.0.0.1:${DIST_PORT}`,
        launchOptions: { args: GL_ARGS },
      },
    },
    {
      name: 'dev',
      testMatch: /\.dev\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${DEV_PORT}`,
        launchOptions: { args: GL_ARGS },
      },
    },
  ],
  webServer: [
    {
      command: 'bun run build && bun run scripts/serve-dist.ts',
      url: `http://127.0.0.1:${DIST_PORT}/`,
      // Reuse is opt-in, not the default. With `!process.env.CI` here, a
      // server left listening from an earlier run — or from another
      // worktree — skips the `bun run build` step entirely and the suite
      // silently grades a stale dist/. That produced both a false red
      // and, worse, would produce a false green. Set E2E_REUSE_SERVER=1
      // when iterating and you know the build is current.
      reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'bun run dev',
      url: `http://127.0.0.1:${DEV_PORT}/`,
      reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
