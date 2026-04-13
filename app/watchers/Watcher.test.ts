import type { Container, ContainerReport } from '../model/container.js';
import Watcher from './Watcher.js';

class ConcreteWatcher extends Watcher {
  async watch(): Promise<ContainerReport[]> {
    return [];
  }

  async watchContainer(container: Container): Promise<ContainerReport> {
    return { container, changed: false };
  }
}

beforeEach(() => {
  vi.resetAllMocks();
});

test('ConcreteWatcher should be an instance of Watcher', () => {
  const watcher = new ConcreteWatcher();
  expect(watcher).toBeInstanceOf(Watcher);
});

test('watch should return an empty array by default', async () => {
  const watcher = new ConcreteWatcher();
  const result = await watcher.watch();
  expect(result).toStrictEqual([]);
});

test('watchContainer should return a report', async () => {
  const watcher = new ConcreteWatcher();
  const container = { name: 'test-container' };
  const result = await watcher.watchContainer(container);
  expect(result).toStrictEqual({ container, changed: false });
});

test('register should set kind, type, name, and configuration', async () => {
  const watcher = new ConcreteWatcher();
  await watcher.register('watcher', 'docker', 'test', {});
  expect(watcher.kind).toBe('watcher');
  expect(watcher.type).toBe('docker');
  expect(watcher.name).toBe('test');
});

test('getId should return type.name', async () => {
  const watcher = new ConcreteWatcher();
  await watcher.register('watcher', 'docker', 'test', {});
  expect(watcher.getId()).toBe('docker.test');
});

test('deregister should call deregisterComponent', async () => {
  const watcher = new ConcreteWatcher();
  const spy = vi.spyOn(watcher, 'deregisterComponent');
  await watcher.deregister();
  expect(spy).toHaveBeenCalledTimes(1);
});

test('validateConfiguration should accept empty config by default', () => {
  const watcher = new ConcreteWatcher();
  expect(watcher.validateConfiguration({})).toStrictEqual({});
});

test('maskConfiguration should return the configuration when called without args', () => {
  const watcher = new ConcreteWatcher();
  watcher.configuration = { url: 'https://example.com' };
  expect(watcher.maskConfiguration()).toStrictEqual({
    url: 'https://example.com',
  });
});

test('maskConfiguration should return passed configuration when provided', () => {
  const watcher = new ConcreteWatcher();
  const config = { token: 'secret' };
  expect(watcher.maskConfiguration(config)).toStrictEqual(config);
});

test('getMetadata should return lastRunAt as undefined when no watch has occurred', () => {
  const watcher = new ConcreteWatcher();
  expect(watcher.getMetadata()).toStrictEqual({ lastRunAt: undefined, nextRunAt: undefined });
});

test('getMetadata should return lastRunAt when set', () => {
  const watcher = new ConcreteWatcher();
  const now = '2026-03-20T12:00:00.000Z';
  watcher.lastRunAt = now;
  expect(watcher.getMetadata()).toStrictEqual({ lastRunAt: now, nextRunAt: undefined });
});

test('getMetadata should include nextRunAt when provided by the watcher', () => {
  class WatcherWithNextRun extends ConcreteWatcher {
    getNextRunAt(): string | undefined {
      return '2026-03-20T13:00:00.000Z';
    }
  }

  const watcher = new WatcherWithNextRun();

  expect(watcher.getMetadata()).toStrictEqual({
    lastRunAt: undefined,
    nextRunAt: '2026-03-20T13:00:00.000Z',
  });
});
