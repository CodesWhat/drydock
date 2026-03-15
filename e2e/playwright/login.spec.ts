import { expect, test } from '@playwright/test';

// These tests do NOT use the auth setup — they test the login flow itself
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login', () => {
  test('shows login form with username and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to Drydock' })).toBeVisible();
    await expect(page.getByPlaceholder('Enter your username')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('shows OIDC provider button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'dex' })).toBeVisible();
  });

  test('shows remember me checkbox', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Remember me')).toBeVisible();
  });

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('Enter your username')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('Enter your username').fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/', { timeout: 15_000 });
  });

  test('failed login shows error message', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('Enter your username')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('Enter your username').fill('admin');
    await page.getByPlaceholder('Enter your password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible({ timeout: 10_000 });
  });
});
