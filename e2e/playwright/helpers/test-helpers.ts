import { type APIRequestContext, type test as base, expect, type Page } from '@playwright/test';

const DEFAULT_BASE_URL = process.env.DD_PLAYWRIGHT_BASE_URL || 'http://localhost:3333';
const HEALTH_ENDPOINTS = ['/health', '/api/health'] as const;
const HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_RETRY_ATTEMPTS = 3;
const HEALTH_RETRY_DELAY_MS = 1_000;

interface Credentials {
  password: string;
  username: string;
}

interface ServerAvailabilityResult {
  checkedUrls: string[];
  healthy: boolean;
}

function getCredentials(): Credentials {
  return {
    username: process.env.DD_USERNAME || 'admin',
    password: process.env.DD_PASSWORD || 'admin',
  };
}

function resolveHealthUrls(baseURL?: string): string[] {
  const targetBaseUrl = (baseURL || DEFAULT_BASE_URL).replace(/\/$/, '');
  return HEALTH_ENDPOINTS.map((endpoint) => `${targetBaseUrl}${endpoint}`);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function checkHealthEndpoints(
  request: APIRequestContext,
  healthUrls: string[],
): Promise<boolean> {
  for (const healthUrl of healthUrls) {
    try {
      const response = await request.get(healthUrl, { timeout: HEALTH_TIMEOUT_MS });
      if (response.ok()) {
        return true;
      }
    } catch {
      // Try the next endpoint.
    }
  }

  return false;
}

async function checkServerAvailability(
  request: APIRequestContext,
  baseURL?: string,
): Promise<ServerAvailabilityResult> {
  const checkedUrls = resolveHealthUrls(baseURL);

  for (let attempt = 1; attempt <= HEALTH_RETRY_ATTEMPTS; attempt += 1) {
    if (await checkHealthEndpoints(request, checkedUrls)) {
      return { healthy: true, checkedUrls };
    }

    if (attempt < HEALTH_RETRY_ATTEMPTS) {
      await wait(HEALTH_RETRY_DELAY_MS);
    }
  }

  return { healthy: false, checkedUrls };
}

async function isServerAvailable(request: APIRequestContext, baseURL?: string): Promise<boolean> {
  const availability = await checkServerAvailability(request, baseURL);
  return availability.healthy;
}

function registerServerAvailabilityCheck(test: typeof base): void {
  test.beforeAll(async ({ request, baseURL }) => {
    const availability = await checkServerAvailability(request, baseURL);
    expect(
      availability.healthy,
      `Playwright QA server is unavailable. Checked health endpoints: ${availability.checkedUrls.join(', ')}`,
    ).toBeTruthy();
  });
}

function getServerUnavailableMessage(baseURL?: string): string {
  const checkedUrls = resolveHealthUrls(baseURL);
  return `Playwright QA server is unavailable. Checked health endpoints: ${checkedUrls.join(', ')}`;
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

async function dismissAnnouncementBanners(page: Page): Promise<void> {
  const dismissButtons = page.locator('[data-testid$="-dismiss-session"]');
  await dismissButtons
    .first()
    .waitFor({ state: 'visible', timeout: 1_500 })
    .catch(() => {});

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dismissButton = dismissButtons.first();
    if (!(await dismissButton.isVisible().catch(() => false))) {
      return;
    }
    await dismissButton.click();
    await page.waitForTimeout(100);
  }
}

async function clickSidebarNavItem(page: Page, label: string): Promise<void> {
  await dismissAnnouncementBanners(page);
  const item = page.locator('aside .nav-item').filter({ hasText: label }).first();
  await expect(item).toBeVisible();
  await item.click();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export {
  checkServerAvailability,
  clickSidebarNavItem,
  dismissAnnouncementBanners,
  ensureSidebarExpanded,
  escapeRegExp,
  getCredentials,
  getServerUnavailableMessage,
  isServerAvailable,
  loginWithBasicAuth,
  registerServerAvailabilityCheck,
};
