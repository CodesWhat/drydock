import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  clickSidebarNavItem,
  dismissAnnouncementBanners,
  ensureSidebarExpanded,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

async function ensureFilterInputVisible(page: Page, placeholder: string): Promise<Locator | null> {
  const input = page.getByPlaceholder(placeholder);
  if (await input.isVisible().catch(() => false)) {
    return input;
  }

  await dismissAnnouncementBanners(page);
  const toggleButtons = page.locator('main').getByRole('button', { name: 'Toggle filters' });
  const toggleCount = await toggleButtons.count();
  for (let index = 0; index < toggleCount; index += 1) {
    await toggleButtons.nth(index).click({ force: true });
    if (await input.isVisible().catch(() => false)) {
      return input;
    }
  }

  return null;
}

test.describe('Config and management views', () => {
  test('config tabs support URL deep-links', async ({ page }) => {
    await page.goto('/config?tab=appearance');
    await dismissAnnouncementBanners(page);
    await expect(page).toHaveURL(/\/config\?tab=appearance/);
    await expect(page.locator('main')).toContainText('Color Theme');

    await dismissAnnouncementBanners(page);
    await page.locator('main').getByRole('button', { name: 'Profile' }).click({ force: true });
    await expect(page).toHaveURL(/\/config\?tab=profile/);
    await expect(page.locator('main')).toContainText(
      /Active Sessions|Loading profile|Failed to load profile/i,
    );

    await dismissAnnouncementBanners(page);
    await page.locator('main').getByRole('button', { name: 'General' }).click({ force: true });
    await expect(page).toHaveURL(/\/config\?tab=general/);
  });

  test('switches between registries/triggers/watchers and preserves URL deep-link queries', async ({
    page,
  }) => {
    await page.goto('/registries');
    await dismissAnnouncementBanners(page);
    await ensureSidebarExpanded(page);

    await clickSidebarNavItem(page, 'Triggers');
    await expect(page).toHaveURL(/\/triggers(?:\?|$)/);

    await clickSidebarNavItem(page, 'Watchers');
    await expect(page).toHaveURL(/\/watchers(?:\?|$)/);

    await page.goto('/registries?q=ghcr');
    await expect(page).toHaveURL(/\/registries\?q=ghcr/);
    const registriesFilterInput = await ensureFilterInputVisible(page, 'Filter by name or type...');
    if (registriesFilterInput) {
      await expect(registriesFilterInput).toHaveValue('ghcr');
    }

    await page.goto('/triggers?q=slack');
    await expect(page).toHaveURL(/\/triggers\?q=slack/);
    const triggersFilterInput = await ensureFilterInputVisible(page, 'Filter by name...');
    if (triggersFilterInput) {
      await expect(triggersFilterInput).toHaveValue('slack');
    }

    await page.goto('/watchers?q=remote');
    await expect(page).toHaveURL(/\/watchers\?q=remote/);
    const watchersFilterInput = await ensureFilterInputVisible(page, 'Filter by name...');
    if (watchersFilterInput) {
      await expect(watchersFilterInput).toHaveValue('remote');
    }
  });
});
