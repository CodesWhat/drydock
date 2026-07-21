import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { notificationHandlers } from './handlers/notifications';
import { settingsHandlers } from './handlers/settings';

const server = setupServer(...settingsHandlers, ...notificationHandlers);

beforeAll(() => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost'),
  });
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => server.close());

async function readJson(response: Response) {
  expect(response.ok).toBe(true);
  return response.json();
}

describe('demo mock contracts', () => {
  test('settings expose updateMode and persist PATCH updates', async () => {
    const initial = await readJson(await fetch('http://localhost/api/v1/settings'));
    expect(initial).toEqual({ internetlessMode: false, updateMode: 'manual' });

    const updated = await readJson(
      await fetch('http://localhost/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updateMode: 'auto' }),
      }),
    );
    expect(updated).toEqual({ internetlessMode: false, updateMode: 'auto' });

    const persisted = await readJson(await fetch('http://localhost/api/v1/settings'));
    expect(persisted.updateMode).toBe('auto');
  });

  test('notification rules use canonical ids and persist bell/template updates', async () => {
    const initial = await readJson(await fetch('http://localhost/api/v1/notifications'));
    const updateAvailable = initial.data.find(
      (rule: { id: string }) => rule.id === 'update-available',
    );
    expect(updateAvailable).toMatchObject({
      id: 'update-available',
      bellEnabled: true,
      bellThreshold: 'all',
      templates: {},
    });

    const templates = {
      'slack.homelab': {
        simpleTitle: 'Custom ${container.name}',
      },
    };
    const updated = await readJson(
      await fetch('http://localhost/api/v1/notifications/update-available', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bellEnabled: false, bellThreshold: 'major', templates }),
      }),
    );
    expect(updated).toMatchObject({
      bellEnabled: false,
      bellThreshold: 'major',
      templates,
    });

    const persisted = await readJson(await fetch('http://localhost/api/v1/notifications'));
    expect(
      persisted.data.find((rule: { id: string }) => rule.id === 'update-available'),
    ).toMatchObject(updated);
  });

  test('notification template preview returns every required rendered field', async () => {
    const preview = await readJson(
      await fetch('http://localhost/api/v1/notifications/update-available/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerId: 'slack.homelab',
          templates: { simpleTitle: 'Preview ${container.name}' },
        }),
      }),
    );

    expect(preview).toEqual({
      simpleTitle: 'Preview Grafana',
      simpleBody: expect.any(String),
      batchTitle: expect.any(String),
    });
  });
});
