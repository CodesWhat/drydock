import { type APIRequestContext, type test as base, expect, type Page } from '@playwright/test';

const DEFAULT_BASE_URL = 'http://localhost:3333';
const HEALTH_ENDPOINT = '/api/health';
const HEALTH_TIMEOUT_MS = 5_000;

interface Credentials {
  password: string;
  username: string;
}

function getCredentials(): Credentials {
  return {
    username: process.env.DD_USERNAME || 'admin',
    password: process.env.DD_PASSWORD || 'admin',
  };
}

async function isServerAvailable(request: APIRequestContext): Promise<boolean> {
  try {
    const response = await request.get(HEALTH_ENDPOINT, { timeout: HEALTH_TIMEOUT_MS });
    return response.ok();
  } catch {
    return false;
  }
}

function registerServerAvailabilityCheck(test: typeof base): void {
  test.beforeEach(async ({ request, baseURL }) => {
    const healthy = await isServerAvailable(request);
    const targetBaseUrl = baseURL || DEFAULT_BASE_URL;
    test.skip(
      !healthy,
      `Skipping Playwright tests because QA server is unavailable at ${targetBaseUrl}${HEALTH_ENDPOINT}`,
    );
  });
}

async function loginWithBasicAuth(
  page: Page,
  credentials: Credentials = getCredentials(),
): Promise<void> {
  await expect(page.getByPlaceholder('Enter your username')).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder('Enter your username').fill(credentials.username);
  await page.getByPlaceholder('Enter your password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', { timeout: 20_000 });
}

async function ensureSidebarExpanded(page: Page): Promise<void> {
  const expandButton = page.getByRole('button', { name: 'Expand sidebar' });
  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
  }
}

async function clickSidebarNavItem(page: Page, label: string): Promise<void> {
  const item = page.locator('aside .nav-item').filter({ hasText: label }).first();
  await expect(item).toBeVisible();
  await item.click();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export {
  clickSidebarNavItem,
  ensureSidebarExpanded,
  escapeRegExp,
  getCredentials,
  isServerAvailable,
  loginWithBasicAuth,
  registerServerAvailabilityCheck,
};
