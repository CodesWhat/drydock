import { expect, test as setup } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  const user = process.env.DD_USERNAME || 'admin';
  const pass = process.env.DD_PASSWORD || 'admin';

  await page.goto('/login');

  // Wait for the login form to appear (handles slow startup / rate limit recovery)
  await expect(page.getByPlaceholder('Enter your username')).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder('Enter your username').fill(user);
  await page.getByPlaceholder('Enter your password').fill(pass);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for redirect to dashboard after successful login
  await expect(page).toHaveURL('/', { timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
