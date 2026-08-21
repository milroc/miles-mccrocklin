// /photographer/ — search, two faceted dropdowns, hero category buttons,
// a masonry wall, and a URL that has to keep up with all of it.
import { test, expect, resultCount, filterParams } from './fixtures';

const wall = (page: import('@playwright/test').Page) =>
  page.getByRole('button').filter({ has: page.locator('img') });

test.describe('photographer — the wall', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/photographer/');
  });

  test('renders photos and states how many', async ({ page }) => {
    const total = await resultCount(page);
    expect(total).toBeGreaterThan(50);
    await expect.poll(() => wall(page).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test('every tile is labelled for screen readers', async ({ page }) => {
    await expect.poll(() => wall(page).count(), { timeout: 20_000 }).toBeGreaterThan(0);
    for (const tile of (await wall(page).all()).slice(0, 12)) {
      const label = await tile.getAttribute('aria-label');
      // A photo tile with no name is a dead end for a screen reader.
      expect(label?.trim()).toBeTruthy();
    }
  });

  test('the editorial intro filters by its hero categories', async ({ page }) => {
    const before = await resultCount(page);
    const hero = page.getByRole('button', { name: 'wildlife', exact: true });
    await expect(hero).toHaveAttribute('aria-pressed', 'false');

    await hero.click();
    await expect(hero).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await filterParams(page)).categories).toBe('wildlife');
    await expect.poll(() => resultCount(page)).toBeLessThan(before);

    // Second press releases it — the intro words are toggles, not a
    // one-way trip.
    await hero.click();
    await expect(hero).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => resultCount(page)).toBe(before);
  });
});

// The graphic-content gate is a three-way handshake: the wall blurs a
// flagged photo behind a Reveal button, the wall's revealed set is
// handed to the viewer, and the viewer re-gates only what the visitor
// has not already opted into. Removing it from both sides at once used
// to pass every spec in this suite.
test.describe('photographer — graphic content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/photographer/');
  });

  // The aria-label of the photo behind the first gate. Read through the
  // wrapper because the tile is aria-hidden while gated, so no role
  // query can reach it — and read up front because revealing one photo
  // re-renders the wall and renumbers "the first gate".
  async function gatedPhotoLabel(page: import('@playwright/test').Page) {
    const gate = page.getByRole('button', { name: 'Reveal graphic content' }).first();
    await expect(gate).toBeVisible();
    const tile = gate.locator('xpath=..').locator('button').first();
    await expect(tile).toHaveAttribute('aria-hidden', 'true');
    await expect(tile).toHaveAttribute('tabindex', '-1');
    const label = await tile.getAttribute('aria-label');
    expect(label, 'the gated photo is labelled').toBeTruthy();
    return label!;
  }

  test('flagged photos are gated until revealed', async ({ page }) => {
    const gates = page.getByRole('button', { name: 'Reveal graphic content' });
    // A hard assertion, not a skip: the flag is in committed data, so
    // it vanishing is a change someone should have to look at.
    await expect(gates, 'photography.json flags graphic photos').not.toHaveCount(0);

    const before = await gates.count();
    await gates.first().click();
    await expect.poll(() => gates.count()).toBe(before - 1);
  });

  test('a gated photo is unreachable until revealed', async ({ page }) => {
    const label = await gatedPhotoLabel(page);

    // While gated the photo is out of the accessibility tree and out of
    // the tab order, and the overlay covers it so no click reaches it.
    // getByRole cannot see an aria-hidden element, so its absence here
    // IS the assertion.
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);

    await page.getByRole('button', { name: 'Reveal graphic content' }).first().click();

    // Pinned by the photo's own label: revealing re-renders the wall, so
    // "the first gate" is a different photo afterwards.
    const tile = page.getByRole('button', { name: label });
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(page.getByRole('dialog', { name: /Media viewer/ })).toBeVisible();
  });

  test('a photo revealed on the wall is not re-gated in the viewer', async ({
    page,
  }) => {
    const label = await gatedPhotoLabel(page);
    await page.getByRole('button', { name: 'Reveal graphic content' }).first().click();
    await page.getByRole('button', { name: label }).click();

    const viewer = page.getByRole('dialog', { name: /Media viewer/ });
    await expect(viewer).toBeVisible();
    // Asking the visitor to consent twice to the same photo is exactly
    // what MasonryWall's revealed-set hand-off exists to prevent.
    await expect(viewer.getByRole('button', { name: 'Reveal graphic content' }))
      .toHaveCount(0);
  });
});

test.describe('photographer — search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/photographer/');
  });

  test('narrows the wall and records the query in the URL', async ({ page }) => {
    const before = await resultCount(page);
    const search = page.getByRole('searchbox', { name: 'Search photos' });

    await search.fill('penguin');
    await expect.poll(async () => (await filterParams(page)).q, { timeout: 10_000 }).toBe('penguin');
    const after = await resultCount(page);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  test('a query with no matches says so instead of showing nothing', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search photos' }).fill('zzzznotathing');
    await expect.poll(() => resultCount(page), { timeout: 10_000 }).toBe(0);
    await expect(page.getByText(/0 photos/)).toBeVisible();
  });

  test('the clear button appears with input and empties it', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: 'Search photos' });
    const clear = page.getByRole('button', { name: 'Clear search' });
    await expect(clear).toBeHidden();

    await search.fill('ice');
    await expect(clear).toBeVisible();
    await clear.click();

    await expect(search).toHaveValue('');
    await expect.poll(async () => (await filterParams(page)).q).toBeUndefined();
  });

  test('a query in the URL is applied on load', async ({ page }) => {
    await page.goto('/photographer/?q=penguin');
    await expect(page.getByRole('searchbox', { name: 'Search photos' })).toHaveValue(
      'penguin',
    );
    await expect.poll(() => resultCount(page), { timeout: 10_000 }).toBeGreaterThan(0);
  });
});

test.describe('photographer — faceted filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/photographer/');
  });

  test('the category dropdown opens, filters, and reports its selection', async ({
    page,
  }) => {
    // The trigger is identified by aria-haspopup rather than its text,
    // because its text is the summary of what is selected — which is the
    // point, and is asserted below.
    const trigger = page.locator('button[aria-haspopup="listbox"]').first();
    await expect(trigger).toHaveText(/Category/);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();

    // Each option carries its own photo count, rolled up by a different
    // code path (photoCounts) than the one that filters the wall
    // (applyFilters). Asserting they agree is a real cross-check;
    // asserting the wall merely got no larger is not — a filter that
    // does nothing at all satisfies that.
    const option = listbox.getByRole('option').first();
    const name = (await option.innerText()).trim();
    const expected = Number(name.match(/\((\d+)\)\s*$/)?.[1] ?? NaN);
    expect(expected, 'the option states its photo count').not.toBeNaN();

    await option.click();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => resultCount(page)).toBe(expected);

    // Escape closes the panel and keeps the selection, which the trigger
    // now names instead of saying "Category".
    await page.keyboard.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).not.toHaveText(/^Category/);
    expect(name.toLowerCase()).toContain(
      (await trigger.innerText()).trim().split(/[,…]/)[0]!.trim().toLowerCase(),
    );
  });

  test('clicking outside closes the dropdown', async ({ page }) => {
    const trigger = page.locator('button[aria-haspopup="listbox"]').first();
    await trigger.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole('listbox')).toBeHidden();
  });

  test('branches in the category tree expand and collapse', async ({ page }) => {
    await page.locator('button[aria-haspopup="listbox"]').first().click();
    const listbox = page.getByRole('listbox');
    // Some branches ship expanded, so the toggle has to be tracked by
    // identity — collapsing "the first Collapse button" would hit a
    // different branch than the one just expanded.
    // Held as an element handle so the second click is provably the same
    // chevron: React keys these rows by id, so the node survives the
    // re-render that expanding causes.
    const chevron = await listbox
      .locator('button[aria-expanded="false"]')
      .first()
      .elementHandle();
    const options = () => listbox.getByRole('option').count();
    const before = await options();

    await chevron!.click();
    await expect.poll(() => chevron!.getAttribute('aria-expanded')).toBe('true');
    await expect.poll(options).toBeGreaterThan(before);

    await chevron!.click();
    await expect.poll(() => chevron!.getAttribute('aria-expanded')).toBe('false');
    await expect.poll(options).toBe(before);
  });

  test('the dropdown has its own search over the tree', async ({ page }) => {
    await page.locator('button[aria-haspopup="listbox"]').first().click();
    const listbox = page.getByRole('listbox');
    const before = await listbox.getByRole('option').count();

    await listbox.getByRole('searchbox').fill('zzzznotathing');
    await expect.poll(() => listbox.getByRole('option').count()).toBeLessThan(before);
  });

  test('the location dropdown filters by country', async ({ page }) => {
    const trigger = page.locator('button[aria-haspopup="listbox"]').nth(1);
    await expect(trigger).toHaveText(/Location/);
    await trigger.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();

    // Same cross-check as the category dropdown: the wall must end up
    // showing exactly the number the option advertised. Proven necessary
    // — with a `<=` assertion, stubbing the country predicate to `true`
    // (a completely dead filter) still passed this spec.
    const option = listbox.getByRole('option').first();
    const expected = Number((await option.innerText()).match(/\((\d+)\)\s*$/)?.[1] ?? NaN);
    expect(expected, 'the option states its photo count').not.toBeNaN();

    await option.click();
    await expect.poll(async () => (await filterParams(page)).locations, {
      timeout: 10_000,
    }).toBeTruthy();
    await expect.poll(() => resultCount(page)).toBe(expected);
  });

  test('"Clear filters" appears only with a selection and resets everything', async ({
    page,
  }) => {
    const clear = page.getByRole('button', { name: 'Clear filters' });
    await expect(clear).toBeHidden();

    const before = await resultCount(page);
    await page.getByRole('searchbox', { name: 'Search photos' }).fill('ice');
    await page.getByRole('button', { name: 'wildlife', exact: true }).click();
    await expect(clear).toBeVisible();

    await clear.click();
    await expect(clear).toBeHidden();
    await expect.poll(() => resultCount(page)).toBe(before);
    await expect.poll(async () => Object.keys(await filterParams(page))).toEqual([]);
  });

  test('filters combine and survive a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'wildlife', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search photos' }).fill('ice');
    await expect
      .poll(async () => (await filterParams(page)).q, { timeout: 10_000 })
      .toBe('ice');
    const combined = await resultCount(page);

    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search photos' })).toHaveValue('ice');
    await expect(
      page.getByRole('button', { name: 'wildlife', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => resultCount(page), { timeout: 10_000 }).toBe(combined);
  });
});
