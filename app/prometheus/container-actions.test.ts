import { expect, test, vi } from 'vitest';
import * as containerActions from './container-actions.js';

test('container actions counter should be properly configured', () => {
  containerActions.init();
  var counter = containerActions.getContainerActionsCounter();
  expect(counter.name).toStrictEqual('dd_container_actions_total');
  expect(counter.labelNames).toStrictEqual(['action']);
});

test('container actions init should replace existing counter when called twice', () => {
  containerActions.init();
  var first = containerActions.getContainerActionsCounter();
  containerActions.init();
  var second = containerActions.getContainerActionsCounter();
  expect(second.name).toStrictEqual('dd_container_actions_total');
  expect(second).not.toBe(first);
});

test('getContainerActionsCounter should return undefined before init', async () => {
  vi.resetModules();
  var fresh = await import('./container-actions.js');
  expect(fresh.getContainerActionsCounter()).toBeUndefined();
});
