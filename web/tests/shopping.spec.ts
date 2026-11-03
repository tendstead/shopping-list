import { test, expect, type Page } from '@playwright/test';
async function synced(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Synced');
}
async function add(page: Page, name: string, counter = false, tags = false) {
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Edit', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  if (counter)
    await page
      .getByRole('checkbox', { name: 'Show counter', exact: true })
      .check();
  if (tags) {
    await page
      .getByRole('checkbox', { name: 'Show person tags', exact: true })
      .check();
    await page.getByLabel('Tag labels', { exact: true }).fill('A B');
  }
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await synced(page);
  await page.getByRole('link', { name: 'Shopping list', exact: true }).click();
}
function name(label: string) {
  return `${label} ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}
test('mobile checklist, counters, tags, duplicate selection, cart and immutable history', async ({
  page,
}) => {
  await page.goto('/');
  await synced(page);
  const milk = name('Milk');
  await add(page, milk, true, true);
  await page
    .getByRole('button', { name: `Increase ${milk}`, exact: true })
    .click();
  await page
    .getByRole('button', { name: `Increase ${milk}`, exact: true })
    .click();
  await page
    .getByRole('button', { name: `Tag A for ${milk}`, exact: true })
    .click();
  await synced(page);
  await expect(
    page.getByLabel(`Count for ${milk}`, { exact: true }),
  ).toHaveText('2');
  await page
    .getByRole('button', { name: 'Add one-time item', exact: true })
    .click();
  await page
    .getByLabel('Name', { exact: true })
    .fill(`  ${milk.toUpperCase()}  `);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Use ${milk}`, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: `Use ${milk}`, exact: true }).click();
  await synced(page);
  await page.getByRole('button', { name: 'Go shopping', exact: true }).click();
  await page
    .getByRole('checkbox', { name: `In cart: ${milk}`, exact: true })
    .click();
  await synced(page);
  await expect(page.getByText('In cart · 1', { exact: true })).toBeVisible();
  await page.getByText('In cart · 1', { exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: `In cart: ${milk}`, exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    page.getByText('Tap Finish again', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await synced(page);
  await expect(
    page.getByLabel(`Count for ${milk}`, { exact: true }),
  ).toHaveText('0');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'History', exact: true })
    .click();
  await expect(page.getByText(milk, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('2 ×', { exact: true }).first()).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Edit', exact: true })
    .click();
  await page
    .getByLabel(`Rename ${milk}`, { exact: true })
    .fill(milk + ' renamed');
  await page.getByLabel(`Rename ${milk}`, { exact: true }).press('Tab');
  await synced(page);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'History', exact: true })
    .click();
  await expect(page.getByText(milk, { exact: true }).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('two phones keep independent views and layouts and receive newly-needed notifications', async ({
  browser,
  page,
}) => {
  await page.goto('/');
  await synced(page);
  const item = name('Bread');
  await add(page, item);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  const second = await context.newPage();
  await second.goto('/');
  await synced(second);
  await second
    .getByRole('button', { name: 'Go shopping', exact: true })
    .click();
  await second
    .getByLabel('Layout', { exact: true })
    .selectOption({ label: 'Walmart' });
  await page
    .getByRole('checkbox', { name: `Needed: ${item}`, exact: true })
    .check();
  await synced(page);
  await expect(
    second.getByRole('checkbox', { name: `In cart: ${item}`, exact: true }),
  ).toBeVisible();
  await expect(second.getByTestId('notification')).toContainText(item);
  await expect(
    page.getByRole('button', { name: 'Go shopping', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Layout', { exact: true })).not.toHaveValue(
    await second.getByLabel('Layout', { exact: true }).inputValue(),
  );
  await context.close();
});
test('offline edits survive reload and reconnect; competing values need a choice', async ({
  browser,
  page,
}) => {
  await page.goto('/');
  await synced(page);
  const item = name('Apples');
  await add(page, item, true);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const second = await context.newPage();
  await second.goto('/');
  await synced(second);
  await page.context().setOffline(true);
  await page
    .getByRole('button', { name: `Increase ${item}`, exact: true })
    .click();
  await expect(page.getByTestId('sync-status')).toContainText('pending');
  await second
    .getByRole('button', { name: `Increase ${item}`, exact: true })
    .click();
  await synced(second);
  await second
    .getByRole('button', { name: `Increase ${item}`, exact: true })
    .click();
  await synced(second);
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByTestId('sync-status')).toHaveText('Needs attention');
  await expect(
    page.getByLabel(`Count for ${item}`, { exact: true }),
  ).toHaveText('2');
  await page
    .getByRole('button', { name: 'Keep my change', exact: true })
    .click();
  await synced(page);
  await expect(
    second.getByLabel(`Count for ${item}`, { exact: true }),
  ).toHaveText('1');
  await context.close();
});
test('keyboard controls and German translation', async ({ page }) => {
  await page.goto('/');
  await synced(page);
  const item = name('Rice');
  await add(page, item);
  const checkbox = page.getByRole('checkbox', {
    name: `Needed: ${item}`,
    exact: true,
  });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await synced(page);
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(
    page.getByRole('button', { name: 'Einkaufen gehen', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Mobile navigation' }),
  ).toContainText('Verlauf');
  await expect(page.getByTestId('sync-status')).toHaveText('Synchronisiert');
});
test('one-time carryover, deletion of needed reusable item and offline layout order', async ({
  page,
}) => {
  await page.goto('/');
  await synced(page);
  const item = name('Soup');
  await add(page, item);
  await page
    .getByRole('checkbox', { name: `Needed: ${item}`, exact: true })
    .check();
  await synced(page);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Edit', exact: true })
    .click();
  await page
    .getByRole('button', { name: `Delete ${item}`, exact: true })
    .click();
  await synced(page);
  await page.getByRole('link', { name: 'Shopping list', exact: true }).click();
  await expect(page.getByTestId(`item-${item}`)).toContainText('One-time');
  await page.getByRole('button', { name: 'Arrange', exact: true }).click();
  await page.context().setOffline(true);
  await page
    .getByRole('button', { name: `Move ${item} up`, exact: true })
    .click();
  await expect(page.getByTestId('sync-status')).toContainText('pending');
  await page.context().setOffline(false);
  await synced(page);
  await page.getByRole('button', { name: 'Go shopping', exact: true }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await synced(page);
  await expect(
    page.getByRole('checkbox', { name: `Needed: ${item}`, exact: true }),
  ).toBeChecked();
});
