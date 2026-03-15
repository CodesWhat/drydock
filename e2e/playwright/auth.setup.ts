import { test as setup } from '@playwright/test';
import { getCredentials, isServerAvailable, loginWithBasicAuth } from './helpers/test-helpers';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page, request, baseURL }) => {
  const healthy = await isServerAvailable(request);
  setup.skip(
    !healthy,
    `Skipping auth setup because QA server is unavailable at ${baseURL || 'http://localhost:3333'}/api/health`,
  );

  const credentials = getCredentials();

  await page.goto('/login');

  await loginWithBasicAuth(page, credentials);

  await page.context().storageState({ path: authFile });
});
