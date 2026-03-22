import { expect, test } from '@playwright/test';
import { registerServerAvailabilityCheck } from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

test.describe('Security view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/security');
    await expect(page.locator('main')).toContainText('Scan Now', { timeout: 30_000 });
  });

  test('CVE breakdown renders and SBOM download control is available', async ({ page }) => {
    const breakdownLabels = ['Critical', 'High', 'Medium', 'Low'];
    for (const label of breakdownLabels) {
      await expect(page.locator('main')).toContainText(label);
    }

    await page.getByRole('button', { name: 'Table view' }).click();

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();
    test.skip(rowCount === 0, 'No security rows available in this run');

    await rows.first().click();
    await expect(page.getByRole('button', { name: 'Download SBOM' })).toBeVisible();
  });
});
