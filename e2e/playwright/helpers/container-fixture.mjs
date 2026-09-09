import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const FIXTURE = 'Countdown fixture Nginx (Hooked) [local/drydock-playwright-nginx-hooked]';

/**
 * Wait for inventory visibility, not update-operation completion. The shared
 * dashboard fixture can be absent while its current container is rediscovered.
 * Node timing stays independent of the countdown test's fake browser clock.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {{now: () => number, sleep: (ms: number) => Promise<unknown>}} timing
 */
async function waitForCountdownFixture(request, timing = { now: () => performance.now(), sleep }) {
  const deadline = timing.now() + 45_000;
  const expired = () => new Error(`${FIXTURE} not ready after 45000ms`);

  while (true) {
    const remaining = deadline - timing.now();
    if (remaining <= 0) throw expired();

    let response;
    try {
      response = await request.get('/api/v1/containers', {
        timeout: Math.min(5_000, remaining),
      });
    } catch {
      throw new Error(`${FIXTURE} request failed`);
    }
    if (!response.ok()) throw new Error(`${FIXTURE} HTTP ${response.status()}`);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${FIXTURE} invalid JSON`);
    }
    if (
      !payload ||
      !Array.isArray(payload.data) ||
      payload.data.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)) ||
      typeof payload.hasMore !== 'boolean' ||
      !Number.isInteger(payload.total) ||
      payload.total < 0 ||
      !Number.isInteger(payload.offset) ||
      payload.offset < 0
    ) {
      throw new Error(`${FIXTURE} malformed collection`);
    }
    if (payload.hasMore || payload.offset !== 0 || payload.total !== payload.data.length) {
      throw new Error(`${FIXTURE} truncated collection`);
    }

    const matches = payload.data.filter(
      (container) =>
        container.name === 'drydock-playwright-nginx-hooked' &&
        container.displayName === 'Nginx (Hooked)' &&
        container.watcher === 'local' &&
        container.agent == null,
    );
    if (matches.length > 1) throw new Error(`${FIXTURE} ambiguous identity`);
    const container = matches[0];
    if (container && (typeof container.id !== 'string' || !container.id.trim())) {
      throw new Error(`${FIXTURE} invalid id`);
    }
    const afterRead = deadline - timing.now();
    if (afterRead <= 0) throw expired();
    if (container) return container;
    await timing.sleep(Math.min(500, afterRead));
  }
}

export { waitForCountdownFixture };
