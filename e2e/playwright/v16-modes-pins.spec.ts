import { expect, type Page, type Route, test } from '@playwright/test';
import {
  dismissAnnouncementBanners,
  escapeRegExp,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

type UpdateMode = 'notify' | 'manual' | 'auto';

interface ContainersPayload {
  data: ContainerFixture[];
}

interface ContainerFixture {
  displayName?: string;
  image: {
    digest?: Record<string, unknown>;
    tag: Record<string, unknown>;
  };
  result?: Record<string, unknown>;
  tagFamily?: string;
  tagPinGated?: boolean;
  tagPinned?: boolean;
  tagPinInfo?: boolean;
  updateAvailable?: boolean;
  updateKind?: Record<string, unknown>;
  updateEligibility?: Record<string, unknown>;
}

const TARGET_CONTAINER = 'Nginx (Hooked)';

async function interceptSettings(page: Page, initialMode: UpdateMode): Promise<() => UpdateMode> {
  let updateMode = initialMode;
  await page.route('**/api/v1/settings', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { updateMode?: UpdateMode };
      if (body.updateMode) updateMode = body.updateMode;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { internetlessMode: false, updateMode },
    });
  });
  return () => updateMode;
}

async function openContainerOverview(page: Page, name = TARGET_CONTAINER): Promise<void> {
  await page.goto('/containers');
  await dismissAnnouncementBanners(page);
  const row = page.getByRole('row', { name: new RegExp(escapeRegExp(name), 'i') });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.locator('[data-test="container-side-detail"]')).toContainText(name);
}

async function selectUpdateMode(page: Page, mode: UpdateMode): Promise<void> {
  await page.goto('/config?tab=general');
  await dismissAnnouncementBanners(page);
  const option = page.locator(`[data-test="update-mode-${mode}"]`);
  await expect(option).toBeEnabled();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/settings') && response.request().method() === 'PATCH',
  );
  await option.click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON()).toEqual({ updateMode: mode });
  await expect(option).toHaveAttribute('aria-pressed', 'true');
}

async function interceptContainer(
  page: Page,
  displayName: string,
  mutate: (container: ContainerFixture) => void,
): Promise<void> {
  await page.route('**/api/v1/containers', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const payload = (await response.json()) as ContainersPayload;
    const container = payload.data.find((candidate) => candidate.displayName === displayName);
    expect(container, `QA fixture ${displayName} must exist`).toBeTruthy();
    mutate(container!);
    await route.fulfill({ response, json: payload });
  });
}

test.describe('v1.6 update modes, scheduling, and pinned tags', () => {
  test('#325 persists notify/manual/auto and updates the Update Status panel', async ({ page }) => {
    const currentMode = await interceptSettings(page, 'manual');

    await selectUpdateMode(page, 'notify');
    expect(currentMode()).toBe('notify');
    await page.reload();
    await expect(page.locator('[data-test="update-mode-notify"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await openContainerOverview(page);

    const notifyPanel = page.locator('[data-test="update-status-panel"]');
    await expect(notifyPanel).toHaveAttribute('data-state', 'notify');
    await expect(notifyPanel.locator('[data-test="update-status-summary"]')).toHaveText(
      "Notifications only — Drydock won't apply updates.",
    );
    await expect(notifyPanel.locator('[data-test="update-status-manual-cta"]')).toBeDisabled();

    await selectUpdateMode(page, 'auto');
    expect(currentMode()).toBe('auto');
    await openContainerOverview(page);
    const autoPanel = page.locator('[data-test="update-status-panel"]');
    await expect(autoPanel).toHaveAttribute('data-state', 'ready');
    await expect(autoPanel.locator('[data-test="update-status-summary"]')).toHaveText(
      'Update available — eligible for automatic dispatch.',
    );
    await expect(autoPanel.locator('[data-test="update-status-manual-cta"]')).toBeEnabled();

    await selectUpdateMode(page, 'manual');
    expect(currentMode()).toBe('manual');
    await page.reload();
    await expect(page.locator('[data-test="update-mode-manual"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('#406 shows a live stabilization countdown, ETA, and manual override', async ({ page }) => {
    const now = new Date('2026-07-13T16:00:00.000Z');
    const liftableAt = new Date(now.getTime() + 6 * 60_000).toISOString();
    await interceptSettings(page, 'manual');
    await page.clock.install({ time: now });
    await interceptContainer(page, TARGET_CONTAINER, (container) => {
      container.updateEligibility = {
        eligible: false,
        evaluatedAt: now.toISOString(),
        blockers: [
          {
            reason: 'maturity-not-reached',
            severity: 'soft',
            actionable: true,
            message: 'The candidate must remain unchanged until the stabilization period ends.',
            liftableAt,
          },
        ],
      };
    });

    await openContainerOverview(page);
    const panel = page.locator('[data-test="update-status-panel"]');
    await expect(panel).toHaveAttribute('data-state', 'soft-blocked');
    const condition = panel.locator('[data-reason="maturity-not-reached"]');
    await expect(condition).toContainText('Maturity policy waiting');
    await expect(condition).toContainText(
      'The candidate must remain unchanged until the stabilization period ends.',
    );
    await expect(condition).toContainText(/6m\s*·\s*unlocks /);
    await expect(panel.locator('[data-test="update-status-manual-cta"]')).toBeEnabled();

    await page.clock.fastForward(60_000);
    await expect(condition).toContainText(/5m\s*·\s*unlocks /);
  });

  test('#498 renders pinned current-to-newer tags as information in table and cards', async ({
    page,
  }) => {
    // The default 1280px project viewport intentionally folds the Update
    // column after Host was promoted in #498. Use a wide table viewport for
    // assertions that specifically exercise the Update cell.
    await page.setViewportSize({ width: 1600, height: 900 });
    await interceptSettings(page, 'manual');
    await interceptContainer(page, 'Traefik Proxy', (container) => {
      container.displayName = 'Immich ML (Pinned)';
      container.tagFamily = 'strict';
      container.tagPinned = true;
      container.tagPinGated = true;
      container.tagPinInfo = true;
      container.updateAvailable = false;
      container.updateKind = {
        kind: 'unknown',
        localValue: null,
        remoteValue: null,
        semverDiff: 'unknown',
      };
      container.image.tag = {
        ...container.image.tag,
        value: 'v2.7.5-openvino',
        semver: true,
        tagPrecision: 'specific',
      };
      container.result = {
        ...container.result,
        tag: 'v2.7.5-openvino',
        updateInsight: { tag: 'v3.0.2-openvino', kind: 'major' },
      };
      container.updateEligibility = {
        eligible: false,
        evaluatedAt: '2026-07-13T16:00:00.000Z',
        blockers: [
          {
            reason: 'no-update-available',
            severity: 'hard',
            actionable: false,
            message: 'Pinned version insight is informational only.',
          },
        ],
      };
    });

    await page.goto('/containers');
    await dismissAnnouncementBanners(page);
    const row = page.getByRole('row', { name: /Immich ML \(Pinned\)/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    const tableFlow = row.locator('.container-version-flow');
    await expect(tableFlow).toContainText('v2.7.5-openvino');
    await expect(tableFlow).toContainText('v3.0.2-openvino');
    const tableText = (await tableFlow.innerText()).replace(/\s+/g, ' ');
    expect(tableText.indexOf('v2.7.5-openvino')).toBeLessThan(tableText.indexOf('v3.0.2-openvino'));
    const tableState = row.locator('[data-test="container-update-state"]');
    await expect(tableState).toHaveText('Major');
    await expect(tableState).not.toContainText('Current');
    await tableState.locator(':scope > span').first().hover();
    await expect(page.getByRole('tooltip')).toHaveText(
      "Newer version available: v3.0.2-openvino. This tag is pinned — drydock won't update it automatically.",
    );
    await expect(row.locator('[data-test="container-tag-pinned-glyph"]')).toBeVisible();
    await expect(row.getByRole('button', { name: /^Update$/ })).toHaveCount(0);

    await row.click();
    const detail = page.locator('[data-test="container-side-detail"]');
    const statusPanel = detail.locator('[data-test="update-status-panel"]');
    await expect(statusPanel).toHaveAttribute('data-state', 'insight');
    await expect(statusPanel.locator('[data-test="update-status-summary"]')).toHaveText(
      'Newer version available — this tag is pinned.',
    );
    await expect(statusPanel.locator('[data-test="update-status-manual-cta"]')).toHaveCount(0);
    await detail.getByRole('button', { name: 'Close details panel' }).click();
    await expect(detail).toHaveCount(0);

    await page.getByRole('button', { name: 'Cards view' }).click();
    const card = page.locator('[data-test="dd-card"]').filter({ hasText: 'Immich ML (Pinned)' });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/v2\.7\.5-openvino\s*→\s*v3\.0\.2-openvino/);
    const cardState = card.locator('[data-test="container-card-update-state"]');
    await expect(cardState).toHaveText('Major');
    await expect(cardState).not.toContainText('Current');
    await cardState.hover();
    await expect(page.getByRole('tooltip')).toHaveText(
      "Newer version available: v3.0.2-openvino. This tag is pinned — drydock won't update it automatically.",
    );
    await expect(card.locator('[data-test="container-tag-pinned-glyph"]')).toBeVisible();
    await expect(card.getByRole('button', { name: /^Update$/ })).toHaveCount(0);
  });

  test('#498 explains same-tag digest changes as image updates in table and cards', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await interceptContainer(page, 'Traefik Proxy', (container) => {
      container.displayName = 'OwnTone (Rebuilt)';
      container.image.tag = {
        ...container.image.tag,
        value: '28.5.1',
        semver: true,
        tagPrecision: 'specific',
      };
      container.image.digest = { watch: true };
      container.updateAvailable = true;
      container.updateKind = {
        kind: 'digest',
        localValue: `sha256:${'a'.repeat(64)}`,
        remoteValue: `sha256:${'b'.repeat(64)}`,
        semverDiff: 'none',
      };
      container.result = { tag: '28.5.1', digest: `sha256:${'b'.repeat(64)}` };
      container.updateEligibility = {
        eligible: true,
        evaluatedAt: '2026-07-13T16:00:00.000Z',
        blockers: [],
      };
    });

    await page.goto('/containers');
    await dismissAnnouncementBanners(page);
    const row = page.getByRole('row', { name: /OwnTone \(Rebuilt\)/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    const tableState = row.locator('[data-test="container-update-state"]');
    await expect(tableState).toHaveText('Image update');
    await expect(tableState).not.toContainText('Digest update');
    await tableState.locator(':scope > span').first().hover();
    await expect(page.getByRole('tooltip')).toHaveText(
      'The tag 28.5.1 now points to a different image build. Redeploy to pull the new image; the version tag itself has not changed.',
    );

    await page.getByRole('button', { name: 'Cards view' }).click();
    const card = page.locator('[data-test="dd-card"]').filter({ hasText: 'OwnTone (Rebuilt)' });
    await expect(card).toBeVisible();
    const cardState = card.locator('[data-test="container-card-update-state"]');
    await expect(cardState).toHaveText('Image update');
    await expect(cardState).not.toContainText('Digest update');
    await cardState.hover();
    await expect(page.getByRole('tooltip')).toHaveText(
      'The tag 28.5.1 now points to a different image build. Redeploy to pull the new image; the version tag itself has not changed.',
    );
  });

  test('#498 keeps Host visible ahead of secondary Software Version metadata at laptop width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1197, height: 900 });
    await page.goto('/containers');
    await dismissAnnouncementBanners(page);

    const table = page.locator('[data-test="containers-grouped-views"] table');
    await expect(table).toBeVisible({ timeout: 30_000 });
    await expect(table.locator('th[data-col-key="server"]')).toContainText('Host');
    await expect(table.locator('th[data-col-key="server"]')).toBeVisible();
    await expect(table.locator('th[data-col-key="softwareVersion"]')).toHaveCount(0);

    const firstContainerRow = table
      .getByRole('row')
      .filter({
        has: page.locator('[data-test="container-server-text"]'),
      })
      .first();
    await expect(firstContainerRow.locator('[data-test="container-server-text"]')).toBeVisible();
    await expect(
      firstContainerRow.locator('[data-test="container-software-version-col"]'),
    ).toHaveCount(0);
  });
});
