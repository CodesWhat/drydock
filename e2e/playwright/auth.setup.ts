import { expect, test as setup } from '@playwright/test';
import {
  checkServerAvailability,
  getCredentials,
  getServerUnavailableMessage,
  loginWithBasicAuth,
} from './helpers/test-helpers';

const authFile = 'playwright/.auth/user.json';

interface QaContainer {
  displayName?: string;
  labels?: Record<string, string>;
  result?: unknown;
  updateAvailable?: boolean;
}

function hasCompleteQaFixtureSnapshot(payload: unknown): boolean {
  const containers = (payload as { data?: QaContainer[] } | undefined)?.data;
  if (!Array.isArray(containers) || containers.length < 29) {
    return false;
  }

  return (
    containers.some(
      (container) =>
        container.displayName === 'Nginx (Hooked)' &&
        container.labels?.['dd.group'] === 'web-stack' &&
        container.result !== null &&
        typeof container.result === 'object' &&
        container.updateAvailable === true,
    ) &&
    containers.some(
      (container) =>
        container.displayName === 'Traefik Proxy' && container.labels?.['dd.group'] === 'infra',
    ) &&
    containers.some(
      (container) =>
        container.displayName === 'Node (Vulnerable)' &&
        container.labels?.['dd.group'] === 'security-test',
    ) &&
    containers.some(
      (container) =>
        container.displayName === 'Remote Nginx' && container.labels?.['dd.group'] === 'remote',
    )
  );
}

// qa-compose.yml watches 31 containers (37 services minus unwatched infra
// like dex, mosquitto, and trivy-server) across every registry provider the
// suite exercises (docker hub, ghcr, mirror.gcr.io, ...). initWatcher() runs
// one full scan across all of them at boot before the cron schedule takes
// over (DD_WATCHER_LOCAL_CRON is parked at Feb 29 specifically so no second
// scan can race this one) — there's no per-container event to hook, only the
// aggregate snapshot this poll already checks for. Under CI load that
// full-fleet scan can outrun a short ceiling even though nothing is actually
// stuck: this is the exact race that flaked issue #832's fixture-snapshot
// check on the rc.2 promotion run, which shares runner/network capacity with
// whatever else is running during a release cut. 300s/240s (up from
// 240s/180s) keeps the same 60s gap between the outer test timeout and the
// poll ceiling for login + storageState overhead.
setup.setTimeout(300_000);

setup('authenticate', async ({ page, request, baseURL }) => {
  const availability = await checkServerAvailability(request, baseURL);
  expect(availability.healthy, getServerUnavailableMessage(baseURL)).toBeTruthy();

  const credentials = getCredentials();

  await page.goto('/login');

  await loginWithBasicAuth(page, credentials);

  await expect
    .poll(
      async () => {
        try {
          const response = await page.request.get('/api/v1/containers?limit=100', {
            timeout: 15_000,
          });
          return response.ok() && hasCompleteQaFixtureSnapshot(await response.json());
        } catch {
          return false;
        }
      },
      {
        message: 'Drydock startup watcher scans did not produce the complete QA fixture snapshot',
        timeout: 240_000,
        intervals: [2_000],
      },
    )
    .toBe(true);

  await page.context().storageState({ path: authFile });
});
