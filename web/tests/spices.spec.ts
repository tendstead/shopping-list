import { test, expect, type Page } from '@playwright/test';
import type { SharedState } from '../src/lib/model';
// Multi-step phone scenarios create several products, reload, and visit two contexts.
test.setTimeout(60000);
const synced = async (page: Page) =>
  expect(page.getByTestId('sync-status')).toHaveText('Synced');
// The acceptance stack shares one household; remove test category assignments
// between scenarios so counts are independent without deleting other test data.
test.beforeEach(async ({ page }) => {
  const state = await (await page.request.get('/api/state')).json();
  for (const item of state.items)
    if (item.category) {
      const result = await page.request.patch(`/api/items/${item.id}`, {
        data: {
          id: crypto.randomUUID(),
          tripId: state.tripId,
          kind: 'item_edit',
          itemId: item.id,
          field: 'category',
          base: item.category,
          value: '',
        },
      });
      expect(result.ok()).toBe(true);
    }
});
test('spice assignment, collapsed shopping, fixed anchor and cart', async ({
  page,
}) => {
  await page.goto('/');
  await synced(page);
  const suffix = `${Date.now()}`;
  const names = ['Bread', 'Kreuzkümmel', 'Milk', 'Paprikapulver', 'Zimt'].map(
    (n) => `${n} ${suffix}`,
  );
  for (let i = 0; i < names.length; i++) {
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill(names[i]);
    if ([1, 3, 4].includes(i))
      await page.getByRole('button', { name: 'Spices', exact: true }).click();
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await synced(page);
    await expect(
      page.getByRole('button', { name: 'Spices', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
  }
  await page.getByRole('link', { name: 'Shopping list', exact: true }).click();
  for (const name of names)
    await page
      .getByRole('checkbox', { name: `Needed: ${name}`, exact: true })
      .click();
  await synced(page);
  await page.getByRole('button', { name: 'Go shopping', exact: true }).click();
  const header = page.getByRole('button', {
    name: 'Spices · 3 remaining',
    exact: true,
  });
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({
    path: `test-results/spices-collapsed-${test.info().project.name}.png`,
    fullPage: true,
  });
  await header.focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({
    path: `test-results/spices-expanded-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await synced(page);
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await page
    .getByRole('checkbox', { name: `In cart: ${names[1]}`, exact: true })
    .click();
  await synced(page);
  const group = page.locator('[data-category="spices"]');
  await expect(
    group.getByRole('button', { name: 'Spices · 2 remaining', exact: true }),
  ).toBeVisible();
  const positions = await page
    .locator('.items')
    .first()
    .locator(':scope > li')
    .evaluateAll((rows) => rows.map((r) => r.textContent));
  expect(positions.findIndex((t) => t?.includes('Spices · 2'))).toBeLessThan(
    positions.findIndex((t) => t?.includes(names[2])),
  );
  for (const name of [names[3], names[4]])
    await page
      .getByRole('checkbox', { name: `In cart: ${name}`, exact: true })
      .click();
  await synced(page);
  await expect(group).toHaveCount(0);
  await page.getByText(/In cart ·/).click();
  await expect(
    page.getByRole('checkbox', { name: `In cart: ${names[1]}`, exact: true }),
  ).toBeChecked();
  await page
    .getByRole('checkbox', { name: `In cart: ${names[4]}`, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Spices · 1 remaining', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/spices-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('assignment changes sync between phones; Arrange retains spice order and add resets', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await synced(page);
  const name = `Cinnamon ${Date.now()}`;
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await synced(page);
  const toggle = page.getByRole('button', {
    name: `Spices for ${name}`,
    exact: true,
  });
  await toggle.click();
  await synced(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const second = await context.newPage();
    await second.goto('/edit');
    await synced(second);
    const other = second.getByRole('button', {
      name: `Spices for ${name}`,
      exact: true,
    });
    await expect(other).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await synced(page);
    await expect(other).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await synced(page);
    await page
      .getByRole('link', { name: 'Shopping list', exact: true })
      .click();
    await page
      .getByRole('checkbox', { name: `Needed: ${name}`, exact: true })
      .click();
    await synced(page);
    await page
      .getByRole('button', { name: 'Add one-time item', exact: true })
      .click();
    const one = `Paprika ${Date.now()}`;
    await page.getByLabel('Name', { exact: true }).fill(one);
    await page.getByRole('button', { name: 'Spices', exact: true }).click();
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await synced(page);
    await page
      .getByRole('button', { name: 'Add one-time item', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Spices', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    // A duplicate selection must retain the existing item's spice category.
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page
      .getByRole('button', { name: `Use ${name}`, exact: true })
      .click();
    await synced(page);
    const saved: SharedState = await (
      await page.request.get('/api/state')
    ).json();
    expect(saved.items.find((i) => i.name === name)?.category).toBe('spices');
    await page
      .getByRole('button', { name: 'Go shopping', exact: true })
      .click();
    await page.getByRole('button', { name: 'Arrange', exact: true }).click();
    await expect(page.locator('[data-category="spices"]')).toHaveCount(0);
    await page
      .getByRole('button', { name: `Move ${one} up`, exact: true })
      .click();
    await synced(page);
    // Verify the existing drag handle also changes order within the group.
    await page
      .getByRole('button', { name: `Move ${name}`, exact: true })
      .dragTo(page.getByTestId(`item-${one}`));
    await synced(page);
    await page
      .getByRole('button', { name: `Move ${one}`, exact: true })
      .dragTo(page.getByTestId(`item-${name}`));
    await synced(page);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Spices · 2 remaining', exact: true })
      .click();
    const group = page.locator('[data-category="spices"]');
    await expect(group.locator('[data-item-id]').first()).toContainText(one);
    const before: SharedState = await (
      await page.request.get('/api/state')
    ).json();
    const selected = await page
      .getByLabel('Layout', { exact: true })
      .inputValue();
    const alternative = before.layouts.find((l) => l.id !== selected)!;
    await page
      .getByLabel('Layout', { exact: true })
      .selectOption(alternative.id);
    await expect(group.locator('[data-item-id]').first()).toContainText(name);
    await page.getByLabel('Layout', { exact: true }).selectOption(selected);
    await expect(group.locator('[data-item-id]').first()).toContainText(one);
    await second
      .getByRole('link', { name: 'Shopping list', exact: true })
      .click();
    await second
      .getByRole('button', { name: 'Go shopping', exact: true })
      .click();
    await expect(
      second.getByRole('button', { name: 'Spices · 2 remaining', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
    await expect(
      page.getByRole('button', { name: 'Spices · 2 remaining', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    await page
      .getByRole('button', { name: 'Spices · 2 remaining', exact: true })
      .click();
    const after: SharedState = await (
      await page.request.get('/api/state')
    ).json();
    expect(after.revision).toBe(before.revision);
    await page
      .getByRole('button', { name: 'Spices · 2 remaining', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Language', exact: true })
      .selectOption('de');
    await expect(
      page.getByRole('button', { name: 'Gewürze · 2 offen', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Gewürze · 2 offen', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
  } finally {
    await context.close();
  }
});
