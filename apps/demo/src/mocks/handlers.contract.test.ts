import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fontHandlers } from './handlers/fonts';
import { notificationHandlers } from './handlers/notifications';
import { settingsHandlers } from './handlers/settings';

const server = setupServer(...settingsHandlers, ...notificationHandlers, ...fontHandlers);

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
  test('rejects malformed and non-object JSON request bodies', async () => {
    const requests = [
      ['PATCH', 'http://localhost/api/v1/settings'],
      ['PATCH', 'http://localhost/api/v1/notifications/update-available'],
      ['POST', 'http://localhost/api/v1/notifications/update-available/preview'],
    ] as const;

    for (const [method, url] of requests) {
      for (const body of ['null', '[]', '{']) {
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        expect(response.status, `${method} ${url} should reject ${body}`).toBe(400);
      }
    }
  });

  test('notification updates cannot overwrite identity or add arbitrary fields', async () => {
    const updated = await readJson(
      await fetch('http://localhost/api/v1/notifications/update-available', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'rewritten-id',
          arbitrary: 'injected',
        }),
      }),
    );

    expect(updated).toMatchObject({ id: 'update-available' });
    expect(updated).not.toHaveProperty('arbitrary');

    const persisted = await readJson(await fetch('http://localhost/api/v1/notifications'));
    const persistedRule = persisted.data.find(
      (rule: { id: string }) => rule.id === 'update-available',
    );
    expect(persistedRule).toMatchObject({ id: 'update-available' });
    expect(persistedRule).not.toHaveProperty('arbitrary');
    expect(persisted.data.some((rule: { id: string }) => rule.id === 'rewritten-id')).toBe(false);
  });

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

  test('serves font CSS for ibm-plex-mono and 404s unknown fonts', async () => {
    const response = await fetch('http://localhost/fonts/ibm-plex-mono/400.css');
    expect(response.status).toBe(200);
    const css = await response.text();
    expect(css).toContain("font-family: 'IBM Plex Mono'");
    expect(css).toContain('ibm-plex-mono@latest/latin-400-normal.woff2');

    const missing = await fetch('http://localhost/fonts/not-a-font/400.css');
    expect(missing.status).toBe(404);
  });
});
