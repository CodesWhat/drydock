import { expect, test, vi } from 'vitest';
import * as webhook from './webhook.js';

test('webhook counter should be properly configured', () => {
  webhook.init();
  var counter = webhook.getWebhookCounter();
  expect(counter.name).toStrictEqual('dd_webhook_total');
  expect(counter.labelNames).toStrictEqual(['action']);
});

test('webhook init should replace existing counter when called twice', () => {
  webhook.init();
  var first = webhook.getWebhookCounter();
  webhook.init();
  var second = webhook.getWebhookCounter();
  expect(second.name).toStrictEqual('dd_webhook_total');
  expect(second).not.toBe(first);
});

test('getWebhookCounter should return undefined before init', async () => {
  vi.resetModules();
  var fresh = await import('./webhook.js');
  expect(fresh.getWebhookCounter()).toBeUndefined();
});
