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

setup.setTimeout(240_000);

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
        timeout: 180_000,
        intervals: [2_000],
      },
    )
    .toBe(true);

  await page.context().storageState({ path: authFile });
});
