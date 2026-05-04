import { expect, type Page, type Route, test } from '@playwright/test';
import {
  clickSidebarNavItem,
  dismissAnnouncementBanners,
  ensureSidebarExpanded,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

type OutboxStatus = 'pending' | 'delivered' | 'dead-letter';

interface OutboxCounts {
  pending: number;
  delivered: number;
  deadLetter: number;
}

interface OutboxEntry {
  id: string;
  eventName: string;
  triggerId: string;
  containerId?: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  status: OutboxStatus;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
  failedAt?: string;
}

interface OutboxResponse {
  data: OutboxEntry[];
  total: number;
  counts: OutboxCounts;
}

const EMPTY_COUNTS: OutboxCounts = {
  pending: 0,
  delivered: 0,
  deadLetter: 0,
};

const OUTBOX_PATH = '/api/notifications/outbox';

function buildOutboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'outbox-dead-1',
    eventName: 'webhook.delivery.failed',
    triggerId: 'registry-webhook',
    containerId: 'redis-cache',
    payload: { containerName: 'Redis Cache' },
    attempts: 3,
    maxAttempts: 3,
    nextAttemptAt: '2026-05-03T16:00:00.000Z',
    status: 'dead-letter',
    lastError: 'HTTP 503: downstream webhook unavailable',
    createdAt: '2026-05-03T15:30:00.000Z',
    failedAt: '2026-05-03T15:45:00.000Z',
    ...overrides,
  };
}

function buildOutboxResponse(data: OutboxEntry[], counts: Partial<OutboxCounts>): OutboxResponse {
  return {
    data,
    total: data.length,
    counts: { ...EMPTY_COUNTS, ...counts },
  };
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function statusFromRequestUrl(url: string): OutboxStatus {
  const requestUrl = new URL(url);
  const rawStatus = requestUrl.searchParams.get('status');
  if (rawStatus === 'pending' || rawStatus === 'delivered' || rawStatus === 'dead-letter') {
    return rawStatus;
  }
  return 'dead-letter';
}

async function mockOutboxReads(
  page: Page,
  responses: Partial<Record<OutboxStatus, OutboxResponse>>,
): Promise<void> {
  await page.route('**/api/notifications/outbox**', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (request.method() !== 'GET' || requestUrl.pathname !== OUTBOX_PATH) {
      await fulfillJson(route, 404, { error: 'Unexpected outbox test request' });
      return;
    }

    const response = responses[statusFromRequestUrl(request.url())];
    await fulfillJson(route, 200, response ?? buildOutboxResponse([], {}));
  });
}

async function openOutbox(page: Page, path = '/notifications/outbox'): Promise<void> {
  await page.goto(path);
  await dismissAnnouncementBanners(page);
  await expect(page.locator('main')).toContainText('Notification outbox', { timeout: 30_000 });
}

test.describe('Notification outbox', () => {
  test('route renders status tabs and preserves selected status query', async ({ page }) => {
    await mockOutboxReads(page, {
      pending: buildOutboxResponse([], { deadLetter: 2, delivered: 1 }),
    });

    await openOutbox(page, '/notifications/outbox?status=pending');

    await expect(page).toHaveURL(/\/notifications\/outbox\?status=pending$/);
    await expect(page.locator('main').getByRole('button', { name: /Dead-letter/ })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: /Pending/ })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: /Delivered/ })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.locator('main')).toContainText('No pending entries');
  });

  test('renders dead-letter entries with failure context and actions', async ({ page }) => {
    const entry = buildOutboxEntry({
      eventName: 'registry.push.failed',
      triggerId: 'webhook-main',
      containerId: 'nginx-hooked',
      lastError: 'HTTP 500: registry webhook timed out',
    });
    await mockOutboxReads(page, {
      'dead-letter': buildOutboxResponse([entry], {
        deadLetter: 1,
        delivered: 4,
        pending: 2,
      }),
    });

    await openOutbox(page);

    const main = page.locator('main');
    const row = main.locator('tbody tr').filter({ hasText: 'registry.push.failed' });

    await expect(main.getByRole('button', { name: /Dead-letter\s+1/ })).toBeVisible();
    await expect(main.getByRole('button', { name: /Pending\s+2/ })).toBeVisible();
    await expect(main.getByRole('button', { name: /Delivered\s+4/ })).toBeVisible();
    await expect(row).toContainText('webhook-main');
    await expect(row).toContainText('nginx-hooked');
    await expect(row).toContainText('3 / 3');
    await expect(row).toContainText('HTTP 500: registry webhook timed out');
    await expect(row.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Discard' })).toBeVisible();
  });

  test('retry requeues a dead-letter entry and refreshes status counts', async ({ page }) => {
    const deadLetterEntry = buildOutboxEntry({
      id: 'retry-target',
      eventName: 'registry.push.failed',
    });
    const requeuedEntry = buildOutboxEntry({
      ...deadLetterEntry,
      attempts: 0,
      failedAt: undefined,
      lastError: undefined,
      status: 'pending',
    });
    let retryRequested = false;

    await page.route('**/api/notifications/outbox**', async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());

      if (
        request.method() === 'POST' &&
        requestUrl.pathname === `${OUTBOX_PATH}/retry-target/retry`
      ) {
        retryRequested = true;
        await fulfillJson(route, 200, requeuedEntry);
        return;
      }

      if (request.method() === 'GET' && requestUrl.pathname === OUTBOX_PATH) {
        const requestedStatus = statusFromRequestUrl(request.url());
        const counts = retryRequested ? { pending: 1 } : { deadLetter: 1 };
        const data =
          requestedStatus === 'dead-letter' && !retryRequested
            ? [deadLetterEntry]
            : requestedStatus === 'pending' && retryRequested
              ? [requeuedEntry]
              : [];

        await fulfillJson(route, 200, buildOutboxResponse(data, counts));
        return;
      }

      await fulfillJson(route, 404, { error: 'Unexpected outbox test request' });
    });

    await openOutbox(page);

    const retryResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/notifications/outbox/retry-target/retry') &&
        response.status() === 200,
    );
    await page
      .locator('tbody tr')
      .filter({ hasText: 'registry.push.failed' })
      .getByRole('button', { name: 'Retry' })
      .click();

    await retryResponse;

    expect(retryRequested).toBeTruthy();
    await expect(page.getByText('Requeued: registry.push.failed')).toBeVisible();
    await expect(page.locator('main')).toContainText('No dead-letter entries');
    await expect(page.locator('main').getByRole('button', { name: /Pending\s+1/ })).toBeVisible();

    await page
      .locator('main')
      .getByRole('button', { name: /Pending/ })
      .click();

    await expect(page).toHaveURL(/\/notifications\/outbox\?status=pending$/);
    await expect(
      page.locator('tbody tr').filter({ hasText: 'registry.push.failed' }),
    ).toContainText('0 / 3');
  });

  test('discard removes an entry and shows the empty state', async ({ page }) => {
    const entry = buildOutboxEntry({
      id: 'discard-target',
      eventName: 'webhook.deadlettered',
    });
    let deleted = false;

    await page.route('**/api/notifications/outbox**', async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());

      if (
        request.method() === 'DELETE' &&
        requestUrl.pathname === `${OUTBOX_PATH}/discard-target`
      ) {
        deleted = true;
        await fulfillJson(route, 204, {});
        return;
      }

      if (request.method() === 'GET' && requestUrl.pathname === OUTBOX_PATH) {
        await fulfillJson(
          route,
          200,
          buildOutboxResponse(deleted ? [] : [entry], { deadLetter: deleted ? 0 : 1 }),
        );
        return;
      }

      await fulfillJson(route, 404, { error: 'Unexpected outbox test request' });
    });

    await openOutbox(page);

    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        response.url().includes('/api/notifications/outbox/discard-target') &&
        response.status() === 204,
    );
    await page
      .locator('tbody tr')
      .filter({ hasText: 'webhook.deadlettered' })
      .getByRole('button', { name: 'Discard' })
      .click();

    await deleteResponse;

    expect(deleted).toBeTruthy();
    await expect(page.getByText('Discarded: webhook.deadlettered')).toBeVisible();
    await expect(page.locator('main')).toContainText('No dead-letter entries');
    await expect(page.locator('tbody tr').filter({ hasText: 'webhook.deadlettered' })).toHaveCount(
      0,
    );
  });

  test('surfaces load errors and recovers on refresh', async ({ page }) => {
    let requestCount = 0;

    await page.route('**/api/notifications/outbox**', async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());

      if (request.method() !== 'GET' || requestUrl.pathname !== OUTBOX_PATH) {
        await fulfillJson(route, 404, { error: 'Unexpected outbox test request' });
        return;
      }

      requestCount += 1;
      if (requestCount === 1) {
        await fulfillJson(route, 503, { error: 'Outbox store unavailable' });
        return;
      }

      await fulfillJson(route, 200, buildOutboxResponse([], {}));
    });

    await openOutbox(page);

    const main = page.locator('main');
    await expect(main).toContainText('Outbox store unavailable');

    const refreshResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/notifications/outbox') &&
        response.status() === 200,
    );
    await main.getByRole('button', { name: 'Refresh' }).click();

    await refreshResponse;

    expect(requestCount).toBe(2);
    await expect(main).not.toContainText('Outbox store unavailable');
    await expect(main).toContainText('No dead-letter entries');
  });

  test('sidebar navigation opens the outbox route', async ({ page }) => {
    await mockOutboxReads(page, {
      'dead-letter': buildOutboxResponse([], {}),
    });

    await page.goto('/');
    await dismissAnnouncementBanners(page);
    await ensureSidebarExpanded(page);

    await clickSidebarNavItem(page, 'Notification outbox');

    await expect(page).toHaveURL(/\/notifications\/outbox(?:\?|$)/);
    await expect(page.locator('main')).toContainText('Notification outbox', { timeout: 30_000 });
  });
});
