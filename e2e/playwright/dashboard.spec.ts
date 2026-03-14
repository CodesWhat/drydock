import { expect, test } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for dashboard to fully load (stat cards appear)
    await expect(page.locator('main')).toContainText('Registries', {
      timeout: 30_000,
    });
  });

  test('displays stat cards with labels', async ({ page }) => {
    const main = page.locator('main');
    await expect(main).toContainText('Registries');
    await expect(main).toContainText('Containers');
    await expect(main).toContainText('Updates Available');
    await expect(main).toContainText('Security Issues');
  });

  test('shows container count with running/stopped breakdown', async ({ page }) => {
    const main = page.locator('main');
    await expect(main).toContainText(/\d+ running/);
  });

  test('shows update maturity detail on updates stat card', async ({ page }) => {
    const main = page.locator('main');
    await expect(main).toContainText(/\d+ fresh · \d+ settled/);
  });

  test('renders updates available section', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText('Updates Available').first()).toBeVisible();
  });

  test('renders update breakdown section', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText('Update Breakdown')).toBeVisible();
  });

  test('renders host status section', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText('Host Status')).toBeVisible();
    await expect(main).toContainText(/connected/i);
  });

  test('renders security overview section', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText('Security Overview')).toBeVisible();
  });

  test('sidebar has navigation links', async ({ page }) => {
    const sidebar = page.getByRole('complementary');
    await expect(sidebar.getByText('Dashboard').first()).toBeVisible();
    await expect(sidebar.getByText('Containers').first()).toBeVisible();
    await expect(sidebar.getByText('Security').first()).toBeVisible();
    await expect(sidebar.getByText('Audit').first()).toBeVisible();
    await expect(sidebar.getByText('System Logs').first()).toBeVisible();
  });
});
