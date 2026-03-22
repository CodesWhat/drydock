import { expect, test } from '@playwright/test';
import { registerServerAvailabilityCheck } from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

test.describe('Audit log', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/audit?page=1');
    await expect(page.getByRole('button', { name: 'Table view' })).toBeVisible({ timeout: 30_000 });
  });

  test('entries render and pagination navigates between pages', async ({ page }) => {
    await page.getByRole('button', { name: 'Table view' }).click();

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    const paginationInfo = page.getByText(/Page \d+ of \d+ \(\d+ entries\)/).first();
    test.skip(
      (await paginationInfo.count()) === 0,
      'Pagination controls are hidden because the audit log has only one page.',
    );

    const beforeText = (await paginationInfo.textContent()) || '';
    const beforePage = Number(beforeText.match(/Page\s+(\d+)/)?.[1] || '1');

    const paginationControls = paginationInfo.locator('xpath=..');
    const prevButton = paginationControls.locator('button').first();
    const nextButton = paginationControls.locator('button').nth(1);

    await expect(nextButton).toBeEnabled();
    await nextButton.click();
    await expect(paginationInfo).toContainText(`Page ${beforePage + 1}`);

    await expect(prevButton).toBeEnabled();
    await prevButton.click();
    await expect(paginationInfo).toContainText(`Page ${beforePage}`);
  });
});
