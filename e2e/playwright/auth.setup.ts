import { expect, test as setup } from '@playwright/test';
import {
  checkServerAvailability,
  getCredentials,
  getServerUnavailableMessage,
  loginWithBasicAuth,
} from './helpers/test-helpers';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page, request, baseURL }) => {
  const availability = await checkServerAvailability(request, baseURL);
  expect(availability.healthy, getServerUnavailableMessage(baseURL)).toBeTruthy();

  const credentials = getCredentials();

  await page.goto('/login');

  await loginWithBasicAuth(page, credentials);

  await page.context().storageState({ path: authFile });
});
