import { expect, type Page, test } from '@playwright/test';
import {
  dismissAnnouncementBanners,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

const LOCAL_HOST_LABEL = 'Local';

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

async function openImagesView(page: Page): Promise<void> {
  await page.goto('/images');
  await dismissAnnouncementBanners(page);
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Toggle filters' }).click();
  await expect(page.getByLabel('Host')).toBeVisible();
}

test.describe('Images', () => {
  test('images page lists images with a host filter', async ({ page }) => {
    await openImagesView(page);

    const rows = page.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);

    const hostSelect = page.getByLabel('Host');
    await expect(
      hostSelect.getByRole('option', { name: LOCAL_HOST_LABEL, exact: true }),
    ).toHaveCount(1);

    await expect(page.locator('th', { hasText: 'Repository' })).toBeVisible();
  });

  test('prune dangling opens a confirm with an estimate and cancels without pruning', async ({
    page,
  }) => {
    await openImagesView(page);

    const serverResponse = await page.request.get('/api/v1/server');
    let actionsEnabled = true;
    if (serverResponse.ok()) {
      actionsEnabled = readContainerActionsFeatureFlag(await serverResponse.json()) ?? true;
    }
    test.skip(!actionsEnabled, 'Container actions disabled by server configuration');

    let pruneRequested = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/v1/images/prune')) {
        pruneRequested = true;
      }
    });

    const hostSelect = page.getByLabel('Host');
    await hostSelect.selectOption({ label: LOCAL_HOST_LABEL });

    const pruneDanglingButton = page.getByRole('button', { name: 'Prune dangling' });
    await expect(pruneDanglingButton).toBeVisible();
    await pruneDanglingButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/reclaims about|Nothing to prune/);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    expect(pruneRequested).toBe(false);
  });
});
