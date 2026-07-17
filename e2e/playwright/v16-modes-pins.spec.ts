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
    tag: Record<string, unknown>;
  };
  result?: Record<string, unknown>;
  tagFamily?: string;
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
    await expect(condition).toContainText(/6m\s*·\s*Lifts at /);
    await expect(panel.locator('[data-test="update-status-manual-cta"]')).toBeEnabled();

    await page.clock.fastForward(60_000);
    await expect(condition).toContainText(/5m\s*·\s*Lifts at /);
  });

  test('#498 renders pinned current-to-newer tags as information in table and cards', async ({
    page,
  }) => {
    await interceptSettings(page, 'manual');
    await interceptContainer(page, 'Traefik Proxy', (container) => {
      container.displayName = 'Immich ML (Pinned)';
      container.tagFamily = 'strict';
      container.tagPinned = true;
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
    await expect(row.getByRole('button', { name: /^Update$/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Cards view' }).click();
    const card = page.locator('[data-test="dd-card"]').filter({ hasText: 'Immich ML (Pinned)' });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/v2\.7\.5-openvino\s*→\s*v3\.0\.2-openvino/);
    await expect(card.locator('[data-test="container-card-update-state"]')).toHaveText('Pinned');
    await expect(card.locator('[data-test="update-insight-kind-badge"]')).toHaveText('Major');
    await expect(card.getByRole('button', { name: /^Update$/ })).toHaveCount(0);
  });
});
