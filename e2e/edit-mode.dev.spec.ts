// Edit mode exists only in the dev build (EDIT_ENABLED is
// process.env.NODE_ENV !== 'production'), so this project runs against
// `bun run dev` rather than dist/.
//
// The whole feature is client-side: edits become ChangeRecords in memory
// plus a localStorage backup, and the only way out is the "Copy LLM"
// prompt. Nothing here writes to disk, so these specs are safe to run
// against the working tree.
import { test, expect } from './fixtures';

const toolbar = (page: import('@playwright/test').Page) =>
  page.getByRole('toolbar', { name: 'Edit mode' });

test.describe('edit mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/resume/');
    // Each spec starts from a clean change log.
    await page.evaluate(() => localStorage.removeItem('edit-changes'));
    await page.reload();
  });

  test('is available in dev and starts switched off', async ({ page }) => {
    await expect(toolbar(page)).toBeVisible();
    await expect(toolbar(page).getByText('EDIT')).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'On' })).toBeVisible();
    // Off means no editing chrome anywhere on the page.
    await expect(page.getByRole('button', { name: 'Visibility' })).toHaveCount(0);
  });

  test('switching on reveals the editing chrome and reports no changes', async ({
    page,
  }) => {
    await toolbar(page).getByRole('button', { name: 'On' }).click();
    await expect(toolbar(page).getByRole('button', { name: 'Off' })).toBeVisible();
    await expect(toolbar(page).getByText('no changes')).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Copy LLM' })).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Discard' })).toBeDisabled();

    await expect.poll(() => page.getByLabel('Visibility').count()).toBeGreaterThan(0);
  });

  test('editing text records one change and the preview follows', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'On' }).click();

    // EditableText is the only contenteditable without an explicit
    // role — NoteBubble and HighLevelFeedback both declare role=textbox.
    const editable = page.locator('[contenteditable]:not([role])').first();
    await editable.scrollIntoViewIfNeeded();
    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' EDITED');
    // The record is pushed on blur, not on every keystroke.
    await editable.blur();

    await expect(toolbar(page).getByText(/1 edit/)).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Discard' })).toBeEnabled();
    // The rendered preview is applyChanges(raw, changes) — the edit has
    // to show up in the page, not just the log.
    await expect(page.getByText(/EDITED/).first()).toBeVisible();
  });

  test('a visibility chip records a change and marks the item', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'On' }).click();
    const chip = page.getByLabel('Visibility').first();
    await chip.getByRole('button', { name: 'ARCH' }).click();

    await expect(toolbar(page).getByText(/1 visibilit/)).toBeVisible();
    await expect.poll(() => page.locator('[data-archived]').count()).toBeGreaterThan(0);
  });

  test('a note records feedback without changing the resume', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'On' }).click();

    const note = page.getByRole('textbox', { name: /High-level feedback/ });
    await note.click();
    await note.pressSequentially('make the summary shorter');
    await note.press('Enter');

    await expect(toolbar(page).getByText(/1 note/)).toBeVisible();
  });

  test('Discard clears the log and the localStorage backup', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'On' }).click();
    const note = page.getByRole('textbox', { name: /High-level feedback/ });
    await note.click();
    await note.pressSequentially('temporary');
    await note.press('Enter');
    await expect(toolbar(page).getByText(/1 note/)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('edit-changes')))
      .toContain('temporary');

    await toolbar(page).getByRole('button', { name: 'Discard' }).click();
    await expect(toolbar(page).getByText('no changes')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('edit-changes')))
      .toBeNull();
  });

  test('changes survive a reload', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'On' }).click();
    const note = page.getByRole('textbox', { name: /High-level feedback/ });
    await note.click();
    await note.pressSequentially('persist me');
    await note.press('Enter');
    await expect(toolbar(page).getByText(/1 note/)).toBeVisible();

    await page.reload();
    // The point of the localStorage backup: an accidental refresh must
    // not throw away edits that live nowhere else.
    await expect(toolbar(page).getByText(/1 note/)).toBeVisible();
  });

  test('"Copy LLM" puts a prompt describing the changes on the clipboard', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await toolbar(page).getByRole('button', { name: 'On' }).click();

    const note = page.getByRole('textbox', { name: /High-level feedback/ });
    await note.click();
    await note.pressSequentially('tighten the summary');
    await note.press('Enter');

    await toolbar(page).getByRole('button', { name: 'Copy LLM' }).click();
    await expect(toolbar(page).getByRole('button', { name: /Copied/ })).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('data/me.json');
    expect(clipboard).toContain('tighten the summary');
    // The prompt carries the machine-readable log too, not just prose.
    expect(clipboard).toContain('"changes"');
  });

  test('mode is locked to text while editing', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'On' }).click();
    const controls = page.getByRole('navigation', { name: 'Resume controls' });
    // Editing rewrites the tree, so the media-heavy modes are disabled
    // rather than left to render half-applied changes.
    await expect(controls.getByRole('button', { name: 'Full' })).toBeDisabled();
    await expect(controls.getByRole('button', { name: '1-Pager' })).toBeDisabled();
  });
});

test.describe('edit mode — production build', () => {
  // This project's baseURL is the dev server, so point at dist directly.
  test.use({ baseURL: 'http://127.0.0.1:4318' });

  test('never mounts on the public site', async ({ page }) => {
    // Asserted against the *rendered* page, not the HTML. dist/resume/
    // index.html is a 2.5 KB SPA shell, and `Copy LLM` genuinely does
    // ship inside a JS chunk — the EditToolbar body is in the bundle,
    // it is simply never mounted. Grepping the shell for that string
    // could not tell the difference, and passed happily with
    // EDIT_ENABLED=true putting the full authoring UI on the live site.
    await page.goto('/resume/');
    await expect(page.getByRole('toolbar', { name: 'Edit mode' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy LLM' })).toHaveCount(0);
    await expect(page.locator('[contenteditable]')).toHaveCount(0);
    await expect(page.getByLabel('Visibility')).toHaveCount(0);
  });
});
