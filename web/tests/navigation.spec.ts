import { test, expect } from '@playwright/test';

test('shared shell preserves tab navigation, history, language and mobile menu', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('sync-status')).toHaveText('Synced');
  await expect(page).toHaveTitle('Shopping List - Tendstead');
  await expect(
    page.getByRole('heading', { name: 'Shopping List', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('.ts-page-heading .ts-eyebrow')).toHaveText(
    'Tendstead',
  );
  await expect(page.locator('.ts-page-heading .ts-eyebrow')).toHaveCSS(
    'order',
    '1',
  );
  const mobile = page.getByRole('navigation', { name: 'Mobile navigation' });
  for (const label of ['History', 'Shopping list', 'Edit']) {
    const link = mobile.getByRole('link', { name: label, exact: true });
    await expect(link.locator('svg')).toBeVisible();
    await expect(link.locator('.ts-nav-label')).toHaveCSS(
      'clip-path',
      'inset(50%)',
    );
  }
  await expect(
    mobile.getByRole('button', { name: 'Menu', exact: true }).locator('span'),
  ).toHaveCSS('clip-path', 'inset(50%)');
  await expect(
    mobile.getByRole('link', { name: 'Shopping list', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await mobile.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await mobile.getByRole('button', { name: 'Menu', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(
    drawer
      .getByRole('link', { name: 'History', exact: true })
      .locator('.ts-nav-label'),
  ).toHaveCSS('clip-path', 'none');
  await drawer.getByRole('link', { name: 'History', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page).toHaveURL(/\/history$/);
  await page.goBack();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await page.goForward();
  await expect(
    mobile.getByRole('link', { name: 'History', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(
    mobile.getByRole('link', { name: 'Verlauf', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(mobile).not.toBeVisible();
  const desktop = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(desktop).toBeVisible();
  await expect(page.locator('.ts-brand strong')).toHaveText('Shopping List');
  await expect(page.locator('.ts-brand .ts-app-label')).toHaveText('Tendstead');
  await expect(page.locator('.ts-brand-mark')).toHaveCSS('font-size', '0px');
  await expect(page.locator('.ts-brand-mark')).toHaveCSS(
    'background-image',
    /tendstead-mark\.svg/,
  );
  expect((await page.request.get('/tendstead-mark.svg')).ok()).toBeTruthy();
  await expect(
    desktop
      .getByRole('link', { name: 'Bearbeiten', exact: true })
      .locator('.ts-nav-label'),
  ).toHaveCSS('clip-path', 'none');
  await expect(
    desktop
      .getByRole('link', { name: 'Bearbeiten', exact: true })
      .locator('svg'),
  ).not.toBeVisible();
  await desktop.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.screenshot({
    path: 'test-results/navigation-desktop.png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/navigation-mobile.png',
  });
});
