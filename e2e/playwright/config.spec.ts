import { expect, test } from '@playwright/test';
import {
  clickSidebarNavItem,
  ensureSidebarExpanded,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

test.describe('Config and management views', () => {
  test('config tabs support URL deep-links', async ({ page }) => {
    await page.goto('/config?tab=appearance');
    await expect(page).toHaveURL(/\/config\?tab=appearance/);
    await expect(page.locator('main')).toContainText('Color Theme');

    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/config\?tab=profile/);
    await expect(page.locator('main')).toContainText(
      /Active Sessions|Loading profile|Failed to load profile/i,
    );

    await page.getByRole('button', { name: 'General' }).click();
    await expect(page).toHaveURL(/\/config\?tab=general/);
  });

  test('switches between registries/triggers/watchers and preserves URL deep-link queries', async ({
    page,
  }) => {
    await page.goto('/registries');
    await ensureSidebarExpanded(page);

    await clickSidebarNavItem(page, 'Triggers');
    await expect(page).toHaveURL(/\/triggers(?:\?|$)/);

    await clickSidebarNavItem(page, 'Watchers');
    await expect(page).toHaveURL(/\/watchers(?:\?|$)/);

    await page.goto('/registries?q=ghcr');
    await expect(page).toHaveURL(/\/registries\?q=ghcr/);
    await expect(page.getByPlaceholder('Filter by name or type...')).toHaveValue('ghcr');

    await page.goto('/triggers?q=slack');
    await expect(page).toHaveURL(/\/triggers\?q=slack/);
    await expect(page.getByPlaceholder('Filter by name...')).toHaveValue('slack');

    await page.goto('/watchers?q=remote');
    await expect(page).toHaveURL(/\/watchers\?q=remote/);
    await expect(page.getByPlaceholder('Filter by name...')).toHaveValue('remote');
  });
});
