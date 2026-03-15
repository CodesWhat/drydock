import { expect, test } from '@playwright/test';
import {
  clickSidebarNavItem,
  ensureSidebarExpanded,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

const SIDEBAR_NAV_TARGETS: Array<{ label: string; urlPattern: RegExp }> = [
  { label: 'Dashboard', urlPattern: /\/(?:\?|$)/ },
  { label: 'Containers', urlPattern: /\/containers(?:\?|$)/ },
  { label: 'Security', urlPattern: /\/security(?:\?|$)/ },
  { label: 'Audit', urlPattern: /\/audit(?:\?|$)/ },
  { label: 'System Logs', urlPattern: /\/logs(?:\?|$)/ },
  { label: 'Hosts', urlPattern: /\/servers(?:\?|$)/ },
  { label: 'Registries', urlPattern: /\/registries(?:\?|$)/ },
  { label: 'Watchers', urlPattern: /\/watchers(?:\?|$)/ },
  { label: 'General', urlPattern: /\/config(?:\?|$)/ },
  { label: 'Notifications', urlPattern: /\/notifications(?:\?|$)/ },
  { label: 'Triggers', urlPattern: /\/triggers(?:\?|$)/ },
  { label: 'Auth', urlPattern: /\/auth(?:\?|$)/ },
  { label: 'Agents', urlPattern: /\/agents(?:\?|$)/ },
];

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await ensureSidebarExpanded(page);
  });

  test('sidebar links navigate to all primary views', async ({ page }) => {
    for (const target of SIDEBAR_NAV_TARGETS) {
      await clickSidebarNavItem(page, target.label);
      await expect(page).toHaveURL(target.urlPattern);
    }
  });

  test('browser back and forward navigation follows visited routes', async ({ page }) => {
    await clickSidebarNavItem(page, 'Containers');
    await expect(page).toHaveURL(/\/containers(?:\?|$)/);

    await clickSidebarNavItem(page, 'Security');
    await expect(page).toHaveURL(/\/security(?:\?|$)/);

    await page.goBack();
    await expect(page).toHaveURL(/\/containers(?:\?|$)/);

    await page.goBack();
    await expect(page).toHaveURL(/\/(?:\?|$)/);

    await page.goForward();
    await expect(page).toHaveURL(/\/containers(?:\?|$)/);

    await page.goForward();
    await expect(page).toHaveURL(/\/security(?:\?|$)/);
  });
});
