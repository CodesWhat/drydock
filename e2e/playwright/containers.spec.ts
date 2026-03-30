import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  dismissAnnouncementBanners,
  escapeRegExp,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

const KNOWN_CONTAINER_NAMES = [
  'Nginx (Hooked)',
  'Redis Cache',
  'Traefik Proxy',
  'Remote Nginx',
  'MongoDB',
  'PostgreSQL',
  'Log Spammer',
] as const;

async function openContainersView(page: Page): Promise<void> {
  await page.goto('/containers');
  await dismissAnnouncementBanners(page);
  await expect(page.getByRole('button', { name: 'Table view' })).toBeVisible({ timeout: 30_000 });
}

async function switchToCardsView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cards view' }).click();
  await expect(page.getByRole('button', { name: /Select / }).first()).toBeVisible({
    timeout: 30_000,
  });
}

async function showFilterPanel(page: Page): Promise<void> {
  const searchInput = page.getByPlaceholder('Search name or image...');
  if (await searchInput.isVisible().catch(() => false)) {
    return;
  }
  await dismissAnnouncementBanners(page);
  await page.getByRole('button', { name: 'Toggle filters' }).click();
  await expect(searchInput).toBeVisible();
}

async function openAnyContainerDetail(page: Page): Promise<string> {
  await page.goto('/containers');
  await dismissAnnouncementBanners(page);
  // Clear any persisted search filter from previous tests
  const searchInput = page.getByPlaceholder('Search name or image...');
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.clear();
    await page.waitForTimeout(300);
  }
  await expect(page.getByRole('button', { name: 'Table view' })).toBeVisible({ timeout: 30_000 });
  const detailPanel = page.locator('[data-test="container-side-detail"]');

  for (const containerName of KNOWN_CONTAINER_NAMES) {
    const locator = page.getByRole('row', {
      name: new RegExp(`\\b${escapeRegExp(containerName)}\\b`, 'i'),
    });
    if ((await locator.count()) > 0) {
      await locator.first().click();
      await expect(detailPanel).toBeVisible({ timeout: 15_000 });
      return containerName;
    }
  }

  const fallback = page.locator('tbody tr').first();
  await expect(fallback).toBeVisible();
  const label = (await fallback.textContent()) || 'selected container';
  await fallback.click();
  await expect(detailPanel).toBeVisible({ timeout: 15_000 });

  return label.trim();
}

function detailTabButton(detailPanel: Locator, iconName: string): Locator {
  return detailPanel.locator(`button:has(iconify-icon[icon*="${iconName}"])`).first();
}

function readContainerActionsFeatureFlag(payload: unknown): boolean | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const rawFeature = (payload as { configuration?: { feature?: unknown } }).configuration?.feature;
  if (!rawFeature || typeof rawFeature !== 'object') {
    return undefined;
  }

  const containerActions = (rawFeature as Record<string, unknown>).containeractions;
  return typeof containerActions === 'boolean' ? containerActions : undefined;
}

test.describe('Containers', () => {
  test('container list loads and supports table/cards/list view toggles', async ({ page }) => {
    await openContainersView(page);

    await page.getByRole('button', { name: 'Table view' }).click();
    await expect(page.locator('th', { hasText: 'Container' })).toBeVisible();

    await page.getByRole('button', { name: 'Cards view' }).click();
    await expect(page.getByRole('button', { name: /Select / }).first()).toBeVisible();

    await page.getByRole('button', { name: 'List view' }).click();
    await expect(page.getByRole('button', { name: /Select / }).first()).toBeVisible();
  });

  test('stack grouping and search filtering narrow the container list', async ({ page }) => {
    await openContainersView(page);
    await switchToCardsView(page);
    await dismissAnnouncementBanners(page);

    const allCards = page.getByRole('button', { name: /Select / });
    const initialCount = await allCards.count();
    expect(initialCount).toBeGreaterThan(0);

    const groupByStackToggle = page
      .locator('[data-test="containers-list-content"] button:has(iconify-icon[icon*="stack"])')
      .first();
    await groupByStackToggle.click();
    await expect(page.locator('[data-test="containers-grouped-views"]')).toContainText(
      /web-stack|infra|data|security-test/i,
    );

    await showFilterPanel(page);
    const searchInput = page.getByPlaceholder('Search name or image...');
    await searchInput.fill('nginx');
    await page.waitForTimeout(500);

    await expect(page.getByText(/nginx/i).first()).toBeVisible({ timeout: 10000 });
    const filteredCards = page.getByRole('button', { name: /Select / });
    const filteredRows = page.locator('[data-test="containers-grouped-views"] tr');
    const filteredCount = (await filteredCards.count()) + (await filteredRows.count());
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('container detail panel opens and required tabs are navigable', async ({ page }) => {
    const selectedName = await openAnyContainerDetail(page);
    const detailPanel = page.locator('[data-test="container-side-detail"]');
    const detailContent = page.locator('[data-test="container-side-tab-content"]');

    await expect(detailPanel).toContainText(selectedName);

    await detailTabButton(detailPanel, 'info').click({ force: true });
    await expect(detailContent).toContainText('Version');

    await detailTabButton(detailPanel, 'scroll').click({ force: true });
    await expect(
      detailContent.locator('text=/Search logs|not running|Log/i').first(),
    ).toBeVisible();

    await detailTabButton(detailPanel, 'sliders-horizontal').click({ force: true });
    await expect(detailContent).toContainText('Environment Variables');

    await detailTabButton(detailPanel, 'cube').click({ force: true });
    await expect(detailContent).toContainText('Labels');

    await detailTabButton(detailPanel, 'lightning').click({ force: true });
    await expect(detailContent).toContainText('Update Workflow');
  });

  test('actions tab shows trigger list and Update/Preview/Scan controls with feature gating', async ({
    page,
  }) => {
    await openAnyContainerDetail(page);

    const detailPanel = page.locator('[data-test="container-side-detail"]');
    const detailContent = page.locator('[data-test="container-side-tab-content"]');

    await detailTabButton(detailPanel, 'lightning').click({ force: true });

    await expect(detailContent).toContainText('Associated Triggers');
    await expect(
      detailContent.getByRole('button', { name: /Preview Update|Previewing/ }),
    ).toBeVisible();
    await expect(detailContent.getByRole('button', { name: 'Scan Now' })).toBeVisible();

    const updateNowCount = await detailContent.getByRole('button', { name: 'Update Now' }).count();
    const forceUpdateCount = await detailContent
      .getByRole('button', { name: /Force Update/i })
      .count();
    expect(updateNowCount + forceUpdateCount).toBeGreaterThan(0);

    const serverResponse = await page.request.get('/api/server');
    let actionsEnabled = true;
    if (serverResponse.ok()) {
      actionsEnabled = readContainerActionsFeatureFlag(await serverResponse.json()) ?? true;
    }

    const scanButton = detailContent.getByRole('button', { name: 'Scan Now' });
    if (actionsEnabled) {
      await expect(scanButton).toBeEnabled();
    } else {
      await scanButton.click();
      await expect(
        page.getByText('Container actions disabled by server configuration'),
      ).toBeVisible();
    }
  });
});
