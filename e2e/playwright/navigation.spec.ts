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
  { label: 'Outbox', urlPattern: /\/notifications\/outbox(?:\?|$)/ },
  { label: 'Triggers', urlPattern: /\/triggers(?:\?|$)/ },
  { label: 'Auth', urlPattern: /\/auth(?:\?|$)/ },
  { label: 'Agents', urlPattern: /\/agents(?:\?|$)/ },
];

const RENDERED_ROUTE_TARGETS: Array<{ path: string; routeName: string }> = [
  { path: '/', routeName: 'dashboard' },
  { path: '/containers', routeName: 'containers' },
  { path: '/containers/missing-container/logs', routeName: 'container-logs' },
  { path: '/security', routeName: 'security' },
  { path: '/servers', routeName: 'servers' },
  { path: '/config', routeName: 'config' },
  { path: '/registries', routeName: 'registries' },
  { path: '/agents', routeName: 'agents' },
  { path: '/triggers', routeName: 'triggers' },
  { path: '/watchers', routeName: 'watchers' },
  { path: '/auth', routeName: 'auth' },
  { path: '/notifications', routeName: 'notifications' },
  { path: '/notifications/outbox', routeName: 'notification-outbox' },
  { path: '/audit', routeName: 'audit' },
  { path: '/logs', routeName: 'logs' },
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

  test('direct routes render their matched view inside the main landmark', async ({ page }) => {
    for (const target of RENDERED_ROUTE_TARGETS) {
      await page.goto(target.path);
      const main = page.locator(`main[data-route-name="${target.routeName}"]`);
      await expect(main).toBeVisible();
      await expect(main.locator(':scope > *').first()).toBeVisible();
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
