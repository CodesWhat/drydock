import { expect, test } from '@playwright/test';
import { registerServerAvailabilityCheck } from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toContainText('Updates Available', { timeout: 30_000 });
  });

  test('stat cards render labels and numeric values', async ({ page }) => {
    const statLabels = ['Registries', 'Containers', 'Updates Available', 'Security Issues'];

    for (const label of statLabels) {
      const card = page.locator('.stat-card').filter({ hasText: label }).first();
      await expect(card).toBeVisible();
      await expect(card).toContainText(/\d+/);
    }
  });

  test('critical dashboard widgets are present', async ({ page }) => {
    const requiredSections = [
      'Updates Available',
      'Update Breakdown',
      'Host Status',
      'Security Overview',
    ];

    for (const section of requiredSections) {
      await expect(page.locator('main')).toContainText(section);
    }
  });
});
