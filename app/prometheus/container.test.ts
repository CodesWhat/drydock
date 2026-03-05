vi.mock('../store/container');
vi.mock('../log');

import {
  clearAllListenersForTests,
  emitContainerAdded,
  emitContainerRemoved,
  emitContainerUpdated,
} from '../event/index.js';
import log from '../log/index.js';
import * as containerModel from '../model/container.js';
import * as store from '../store/container.js';
import * as container from './container.js';

beforeEach(() => {
  vi.clearAllMocks();
  clearAllListenersForTests();
  container._resetPrometheusContainerStateForTests();
});

test('gauge must be populated when containers are in the store', async () => {
  store.getContainers = () => [
    {
      id: 'container-123456789',
      name: 'test',
      watcher: 'test',
      image: {
        id: 'image-123456789',
        registry: {
          name: 'registry',
          url: 'https://hub',
          lookupImage: 'library/nginx',
        },
        name: 'organization/image',
        tag: {
          value: 'version',
          semver: false,
        },
        digest: {
          watch: false,
          repo: undefined,
        },
        architecture: 'arch',
        os: 'os',
        created: '2021-06-12T05:33:38.440Z',
      },
      result: {
        tag: 'version',
      },
      updatePolicy: {
        skipTags: ['2.0.0'],
        snoozeUntil: '2099-01-01T00:00:00.000Z',
      },
    },
  ];
  const gauge = container.init();
  const spySet = vi.spyOn(gauge, 'set');
  await gauge.collect();
  expect(spySet).toHaveBeenCalledWith(
    {
      id: 'container-123456789',
      image_architecture: 'arch',
      image_created: '2021-06-12T05:33:38.440Z',
      image_digest_repo: undefined,
      image_digest_watch: false,
      image_id: 'image-123456789',
      image_name: 'organization/image',
      image_os: 'os',
      image_registry_lookup_image: 'library/nginx',
      image_registry_name: 'registry',
      image_registry_url: 'https://hub',
      image_tag_semver: false,
      image_tag_value: 'version',
      name: 'test',
      result_tag: 'version',
      watcher: 'test',
    },
    1,
  );
});

test('gauge must silently ignore labels not in the initial labelset', async () => {
  store.getContainers = () => [
    {
      extra: 'extra',
    },
  ];
  const spyLog = vi.spyOn(log, 'warn');
  const gauge = container.init();
  const spySet = vi.spyOn(gauge, 'set');
  await gauge.collect();
  expect(spyLog).not.toHaveBeenCalled();
  expect(spySet).toHaveBeenCalledWith({}, 1);
});

test('gauge should warn when flattening a container throws', async () => {
  const circular: any = { id: 'broken-container' };
  circular.self = circular;
  store.getContainers = () => [circular];
  const spyFlatten = vi.spyOn(containerModel, 'flatten').mockImplementation(() => {
    throw new Error('flatten failed');
  });
  const spyWarn = vi.spyOn(log, 'warn');
  const spyDebug = vi.spyOn(log, 'debug');

  const gauge = container.init();
  await gauge.collect();

  expect(spyWarn).toHaveBeenCalledWith(
    expect.stringContaining('broken-container - Error when adding container to the metrics'),
  );
  expect(spyDebug).toHaveBeenCalled();
  spyFlatten.mockRestore();
});

test('gauge collect should avoid rebuilding from store when unchanged', async () => {
  const getContainers = vi.fn(() => [
    {
      id: 'container-unchanged',
      name: 'test',
      watcher: 'test',
      image: {
        id: 'image-unchanged',
        registry: {
          name: 'registry',
          url: 'https://hub',
          lookupImage: 'library/nginx',
        },
        name: 'organization/image',
        tag: {
          value: 'version',
          semver: false,
        },
        digest: {
          watch: false,
          repo: undefined,
        },
        architecture: 'arch',
        os: 'os',
      },
      result: {
        tag: 'version',
      },
    },
  ]);
  store.getContainers = getContainers;
  const gauge = container.init();

  await gauge.collect();
  await gauge.collect();

  expect(getContainers).toHaveBeenCalledTimes(1);
});

test('event handlers should skip updates while gauge is marked for rebuild', () => {
  store.getContainers = () => [];
  const gauge = container.init();
  const spySet = vi.spyOn(gauge, 'set');
  const spyRemove = vi.spyOn(gauge, 'remove');

  emitContainerAdded({ id: 'container-added-before-collect' });
  emitContainerUpdated({ id: 'container-updated-before-collect' });
  emitContainerRemoved({ id: 'container-removed-before-collect' });

  expect(spySet).not.toHaveBeenCalled();
  expect(spyRemove).not.toHaveBeenCalled();
});

test('event handlers should upsert, replace labels, and remove tracked containers after collect', async () => {
  store.getContainers = () => [];
  const gauge = container.init();
  const spySet = vi.spyOn(gauge, 'set');
  const spyRemove = vi.spyOn(gauge, 'remove');
  await gauge.collect();

  emitContainerAdded({ id: 'container-event-1', name: 'name-1' });
  emitContainerUpdated({ id: 'container-event-1', name: 'name-2' });
  emitContainerRemoved({ id: 'container-event-1' });

  expect(spySet).toHaveBeenCalledWith(
    {
      id: 'container-event-1',
      name: 'name-1',
    },
    1,
  );
  expect(spyRemove).toHaveBeenCalledWith({
    id: 'container-event-1',
    name: 'name-1',
  });
  expect(spyRemove).toHaveBeenCalledWith({
    id: 'container-event-1',
    name: 'name-2',
  });
});

test('remove handler should mark gauge for rebuild on invalid or unknown container ids', async () => {
  store.getContainers = () => [];
  const gauge = container.init();
  const spySet = vi.spyOn(gauge, 'set');
  const spyRemove = vi.spyOn(gauge, 'remove');
  await gauge.collect();

  emitContainerRemoved({});
  emitContainerAdded({ id: 'container-skipped-while-rebuild' });
  expect(spySet).not.toHaveBeenCalled();

  await gauge.collect();
  emitContainerRemoved({ id: 'container-not-tracked' });
  emitContainerUpdated({ id: 'container-skipped-after-unknown-remove' });
  expect(spySet).not.toHaveBeenCalled();
  expect(spyRemove).not.toHaveBeenCalled();
});

test('internal upsert should no-op when gauge is not initialized', () => {
  expect(() => container._upsertContainerMetricForTests({ id: 'no-gauge-upsert' })).not.toThrow();
});

test('internal remove should no-op when gauge is not initialized', () => {
  expect(() => container._removeContainerMetricForTests({ id: 'no-gauge-remove' })).not.toThrow();
});

test('internal rebuild should no-op when gauge is not initialized', () => {
  const getContainers = vi.fn(() => []);
  store.getContainers = getContainers;

  container._rebuildContainerGaugeFromStoreForTests();

  expect(getContainers).not.toHaveBeenCalled();
});

test('init should replace existing gauge when called multiple times', () => {
  store.getContainers = () => [];
  const firstGauge = container.init();

  const secondGauge = container.init();

  expect(secondGauge).toBeDefined();
  expect(secondGauge).not.toBe(firstGauge);
});
