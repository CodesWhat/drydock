import { expect, test } from '@playwright/test';
import {
  getCredentials,
  loginWithBasicAuth,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login flow', () => {
  test('basic auth credentials login redirects to dashboard', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Sign in to Drydock' })).toBeVisible();

    await loginWithBasicAuth(page, getCredentials());

    await expect(page.locator('main')).toContainText('Updates Available');
  });

  test('redirects unauthenticated users to login before dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
