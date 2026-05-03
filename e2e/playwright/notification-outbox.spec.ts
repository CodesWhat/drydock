import { expect, test } from '@playwright/test';
import {
  clickSidebarNavItem,
  dismissAnnouncementBanners,
  ensureSidebarExpanded,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

test.describe('Notification outbox', () => {
  test('route renders status tabs and preserves selected status query', async ({ page }) => {
    await page.goto('/notifications/outbox?status=pending');
    await dismissAnnouncementBanners(page);

    await expect(page).toHaveURL(/\/notifications\/outbox\?status=pending$/);
    await expect(page.locator('main')).toContainText('Notification outbox', { timeout: 30_000 });
    await expect(page.locator('main').getByRole('button', { name: /Dead-letter/ })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: /Pending/ })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: /Delivered/ })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  test('sidebar navigation opens the outbox route', async ({ page }) => {
    await page.goto('/');
    await dismissAnnouncementBanners(page);
    await ensureSidebarExpanded(page);

    await clickSidebarNavItem(page, 'Notification outbox');

    await expect(page).toHaveURL(/\/notifications\/outbox(?:\?|$)/);
    await expect(page.locator('main')).toContainText('Notification outbox', { timeout: 30_000 });
  });
});
