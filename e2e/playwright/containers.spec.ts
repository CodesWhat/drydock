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
  await expect(page.locator('[data-test="dd-card"]').first()).toBeVisible({
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
    await expect(searchInput).toHaveValue('');
  }
  await expect(page.getByRole('button', { name: 'Table view' })).toBeVisible({ timeout: 30_000 });
  const detailPanel = page.locator('[data-test="container-side-detail"]');

  // Ensure the table has rendered its rows before the count()-based lookups below;
  // locator.count() does not auto-wait, so a still-filtering table would yield 0.
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

  for (const containerName of KNOWN_CONTAINER_NAMES) {
    // Plain substring match: a \b anchor after an escaped ")" (e.g. "Nginx (Hooked)")
    // never matches, silently skipping the intended row.
    const locator = page.getByRole('row', {
      name: new RegExp(escapeRegExp(containerName), 'i'),
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
  test('container list loads and supports table/cards view toggles', async ({ page }) => {
    await openContainersView(page);

    await page.getByRole('button', { name: 'Table view' }).click();
    await expect(page.locator('th', { hasText: 'Container' })).toBeVisible();

    await switchToCardsView(page);
    await expect(page.getByRole('button', { name: 'List view' })).toHaveCount(0);
  });

  test('stack grouping and search filtering narrow the container list', async ({ page }) => {
    await openContainersView(page);
    await switchToCardsView(page);
    await dismissAnnouncementBanners(page);

    const allCards = page.locator('[data-test="dd-card"]');
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

    await expect(page.getByText(/nginx/i).first()).toBeVisible({ timeout: 10000 });
    const filteredCards = page.locator('[data-test="dd-card"]');
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

    const serverResponse = await page.request.get('/api/v1/server');
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

  test('selecting rows shows the selection bar and Update selected opens a confirm that can be cancelled', async ({
    page,
  }) => {
    await openContainersView(page);
    await page.getByRole('button', { name: 'Table view' }).click();
    await expect(page.locator('th', { hasText: 'Container' })).toBeVisible();

    const serverResponse = await page.request.get('/api/v1/server');
    let actionsEnabled = true;
    if (serverResponse.ok()) {
      actionsEnabled = readContainerActionsFeatureFlag(await serverResponse.json()) ?? true;
    }
    test.skip(!actionsEnabled, 'container actions disabled by server configuration');

    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

    const checkboxes = page.locator('[data-test="container-select"]');
    await expect(checkboxes.first()).toBeVisible({ timeout: 15_000 });
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    const selectionBar = page.locator('[data-test="container-selection-bar"]');
    await expect(selectionBar).toBeVisible({ timeout: 10_000 });
    await expect(selectionBar).toContainText('2 containers selected');

    const updateButton = page.locator('[data-test="container-selection-update"]');
    const clearButton = page.locator('[data-test="container-selection-clear"]');

    if (await updateButton.isDisabled()) {
      await clearButton.click();
      await expect(selectionBar).toBeHidden();
      return;
    }

    await updateButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(/Update \d+ selected container/);
    await expect(dialog).toContainText(/Will update|Skipped|Blocked/);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(selectionBar).toBeVisible();
    await expect(selectionBar).toContainText('2 containers selected');

    await clearButton.click();
    await expect(selectionBar).toBeHidden();
    await expect(checkboxes.nth(0)).not.toBeChecked();
    await expect(checkboxes.nth(1)).not.toBeChecked();
  });
});
