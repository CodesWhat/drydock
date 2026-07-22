import { expect, type Page, test } from '@playwright/test';
import {
  dismissAnnouncementBanners,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

const HEALTH_FIXTURE_NAME = 'drydock-playwright-health-transition';
const HEALTH_FIXTURE_URL = process.env.DD_PLAYWRIGHT_HEALTH_FIXTURE_URL || 'http://127.0.0.1:3334';
const APP_ORIGIN = new URL(process.env.DD_PLAYWRIGHT_BASE_URL || 'http://localhost:3333').origin;

interface ApiContainer {
  health?: string;
  id: string;
  name: string;
}

interface CollectionEnvelope<T> {
  data: T[];
}

interface NotificationRule {
  bellEnabled: boolean;
  id: string;
}

interface PreferencesEnvelope {
  apiVersion: number;
  preferences: Record<string, unknown> | null;
  schemaVersion: number | null;
}

async function findHealthFixture(page: Page): Promise<ApiContainer | undefined> {
  const response = await page.context().request.get('/api/v1/containers?limit=100');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as CollectionEnvelope<ApiContainer>;
  return envelope.data.find((container) => container.name === HEALTH_FIXTURE_NAME);
}

async function waitForHealthFixture(page: Page, expectedHealth: string): Promise<ApiContainer> {
  await expect
    .poll(async () => (await findHealthFixture(page))?.health, {
      message: `Expected ${HEALTH_FIXTURE_NAME} to become ${expectedHealth}`,
      timeout: 30_000,
    })
    .toBe(expectedHealth);

  const fixture = await findHealthFixture(page);
  expect(fixture).toBeDefined();
  return fixture as ApiContainer;
}

async function refreshHealthFixture(
  page: Page,
  fixtureId: string,
  expectedHealth: string,
): Promise<ApiContainer> {
  const response = await page
    .context()
    .request.post(`/api/v1/containers/${encodeURIComponent(fixtureId)}/watch`, {
      headers: { Origin: APP_ORIGIN },
      timeout: 45_000,
    });
  expect(response.ok()).toBeTruthy();
  const fixture = (await response.json()) as ApiContainer;
  expect(
    fixture.health,
    `Expected targeted refresh of ${HEALTH_FIXTURE_NAME} to report ${expectedHealth}`,
  ).toBe(expectedHealth);

  return fixture;
}

async function startHealthEventProbe(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const probeWindow = window as typeof window & {
      __ddHealthProbe?: {
        events: Array<Record<string, unknown>>;
        source: EventSource;
      };
    };
    const events: Array<Record<string, unknown>> = [];
    const source = new EventSource('/api/v1/events/ui');
    probeWindow.__ddHealthProbe = { events, source };

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out connecting the health-event SSE probe'));
      }, 10_000);

      source.addEventListener(
        'dd:connected',
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      source.addEventListener('dd:container-unhealthy', (event) => {
        try {
          events.push(JSON.parse((event as MessageEvent).data) as Record<string, unknown>);
        } catch {
          events.push({ invalidPayload: true });
        }
      });
    });
  });
}

async function stopHealthEventProbe(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(() => {
    const probeWindow = window as typeof window & {
      __ddHealthProbe?: { source: EventSource };
    };
    probeWindow.__ddHealthProbe?.source.close();
  });
}

async function disableServerPreferenceSync(page: Page): Promise<void> {
  if (page.isClosed()) return;
  const response = await page.context().request.get('/api/v1/preferences');
  if (!response.ok()) return;
  const envelope = (await response.json()) as PreferencesEnvelope;
  if (!envelope.preferences || envelope.schemaVersion === null) return;

  await page.context().request.patch('/api/v1/preferences', {
    headers: { Origin: APP_ORIGIN },
    data: {
      apiVersion: envelope.apiVersion,
      schemaVersion: envelope.schemaVersion,
      preferences: {
        ...envelope.preferences,
        sync: { enabled: false },
      },
    },
  });
}

test.describe('v1.6 discussion promises', () => {
  test('#198 health-only transitions refresh the notification bell', async ({ page, request }) => {
    const notificationsResponse = await page.context().request.get('/api/v1/notifications');
    expect(notificationsResponse.ok()).toBeTruthy();
    const rules = (await notificationsResponse.json()) as CollectionEnvelope<NotificationRule>;
    const originalRule = rules.data.find((rule) => rule.id === 'container-unhealthy');
    expect(originalRule).toBeDefined();

    let auditResponseCount = 0;
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname === '/api/v1/audit') {
        auditResponseCount += 1;
      }
    });

    try {
      const enableBellResponse = await page
        .context()
        .request.patch('/api/v1/notifications/container-unhealthy', {
          headers: { Origin: APP_ORIGIN },
          data: { bellEnabled: true },
        });
      expect(enableBellResponse.ok()).toBeTruthy();

      const resetResponse = await request.get(`${HEALTH_FIXTURE_URL}/cgi-bin/healthy`);
      expect(resetResponse.ok()).toBeTruthy();
      const healthyFixture = await waitForHealthFixture(page, 'healthy');

      await page.goto('/');
      await dismissAnnouncementBanners(page);
      await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
      await expect.poll(() => auditResponseCount, { timeout: 15_000 }).toBeGreaterThan(0);
      await startHealthEventProbe(page);
      const auditResponsesBeforeTransition = auditResponseCount;

      const unhealthyResponse = await request.get(`${HEALTH_FIXTURE_URL}/cgi-bin/unhealthy`);
      expect(unhealthyResponse.ok()).toBeTruthy();
      await refreshHealthFixture(page, healthyFixture.id, 'unhealthy');

      await expect
        .poll(
          () =>
            page.evaluate((containerName) => {
              const probeWindow = window as typeof window & {
                __ddHealthProbe?: { events: Array<Record<string, unknown>> };
              };
              return probeWindow.__ddHealthProbe?.events.some(
                (event) => event.containerName === containerName && event.health === 'unhealthy',
              );
            }, HEALTH_FIXTURE_NAME),
          {
            message: 'Expected the browser SSE stream to receive dd:container-unhealthy',
            timeout: 15_000,
          },
        )
        .toBe(true);
      await expect
        .poll(() => auditResponseCount, {
          message: 'Expected the mounted notification bell to refetch audit entries',
          timeout: 15_000,
        })
        .toBeGreaterThan(auditResponsesBeforeTransition);

      await page.getByRole('button', { name: 'Notifications', exact: true }).click();
      await expect(
        page
          .locator('[data-test="notification-row"]')
          .filter({ hasText: HEALTH_FIXTURE_NAME })
          .first(),
      ).toBeVisible();
    } finally {
      await stopHealthEventProbe(page).catch(() => {});
      await request.get(`${HEALTH_FIXTURE_URL}/cgi-bin/healthy`).catch(() => {});
      if (originalRule) {
        await page
          .context()
          .request.patch('/api/v1/notifications/container-unhealthy', {
            headers: { Origin: APP_ORIGIN },
            data: { bellEnabled: originalRule.bellEnabled },
          })
          .catch(() => {});
      }
    }
  });

  test('#220 preference changes synchronize across two browser contexts', async ({
    baseURL,
    browser,
    page,
  }) => {
    expect(baseURL).toBeTruthy();
    let secondContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

    try {
      await page.goto('/config?tab=appearance');
      await dismissAnnouncementBanners(page);

      const syncToggle = page.locator('[data-test="sync-toggle"]');
      await expect(syncToggle).toBeVisible();

      if ((await syncToggle.getAttribute('aria-checked')) === 'true') {
        const disabledWrite = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/v1/preferences') &&
            response.request().method() === 'PATCH' &&
            response.ok(),
        );
        await syncToggle.click();
        await disabledWrite;
        await expect(syncToggle).toHaveAttribute('aria-checked', 'false');
      }

      const expandSidebarButton = page.getByRole('button', { name: 'Expand sidebar' });
      if (await expandSidebarButton.isVisible().catch(() => false)) {
        await expandSidebarButton.click();
      }
      await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();

      const enabledWrite = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/preferences') &&
          response.request().method() === 'PATCH' &&
          response.ok(),
      );
      await syncToggle.click();
      await enabledWrite;
      await expect(syncToggle).toHaveAttribute('aria-checked', 'true');

      const cookies = await page.context().cookies();
      secondContext = await browser.newContext({ baseURL });
      await secondContext.addCookies(cookies);
      const secondPage = await secondContext.newPage();
      await secondPage.goto('/');
      await dismissAnnouncementBanners(secondPage);
      await expect(secondPage.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible({
        timeout: 15_000,
      });

      const synchronizedWrite = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/preferences') &&
          response.request().method() === 'PATCH' &&
          response.ok(),
      );
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await synchronizedWrite;

      await expect(secondPage.getByRole('button', { name: 'Expand sidebar' })).toBeVisible({
        timeout: 15_000,
      });
      await expect
        .poll(() =>
          secondPage.evaluate(() => {
            const raw = localStorage.getItem('dd-preferences');
            if (!raw) return undefined;
            return (JSON.parse(raw) as { layout?: { sidebarCollapsed?: boolean } }).layout
              ?.sidebarCollapsed;
          }),
        )
        .toBe(true);
    } finally {
      await secondContext?.close();
      await disableServerPreferenceSync(page).catch(() => {});
    }
  });
});
