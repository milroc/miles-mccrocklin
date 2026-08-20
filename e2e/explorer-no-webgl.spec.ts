// The globe's failure path, in a browser launched without 3D APIs —
// the state a visitor on locked-down hardware or a hardened profile
// actually arrives in, rather than a monkey-patched getContext.
//
// Its own file because launchOptions cannot be scoped to a describe
// block; Playwright needs a separate worker for a differently-launched
// browser.
import { test, expect } from './fixtures';

test.use({ launchOptions: { args: ['--disable-webgl', '--disable-3d-apis'] } });

test('explorer without WebGL states the cause and offers a door out', async ({
  page,
}) => {
  await page.goto('/explorer/');
  const mount = page.locator('[data-globe-failed]');
  await expect(mount).toHaveAttribute('data-globe-failed', 'webgl', {
    timeout: 30_000,
  });
  // Cause-accurate copy, and a way onward that isn't a reload — a
  // 'load' failure offers "try again", a WebGL one must not.
  await expect(page.getByText(/needs WebGL/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /photos live here/i })).toHaveAttribute(
    'href',
    '/photographer/',
  );
});
