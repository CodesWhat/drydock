// @ts-nocheck
vi.mock('../store/container');
vi.mock('../log');

import log from '../log/index.js';
import * as containerModel from '../model/container.js';
import * as store from '../store/container.js';
import * as container from './container.js';

test('gauge must be populated when containers are in the store', async () => {
  vi.useFakeTimers();
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
  vi.runOnlyPendingTimers();
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
  vi.useFakeTimers();
  store.getContainers = () => [
    {
      extra: 'extra',
    },
  ];
  const spyLog = vi.spyOn(log, 'warn');
  const gauge = container.init();
  const spySet = vi.spyOn(gauge, 'set');
  vi.runOnlyPendingTimers();
  expect(spyLog).not.toHaveBeenCalled();
  expect(spySet).toHaveBeenCalledWith({}, 1);
});

test('gauge should warn when flattening a container throws', async () => {
  vi.useFakeTimers();
  const circular: any = { id: 'broken-container' };
  circular.self = circular;
  store.getContainers = () => [circular];
  const spyFlatten = vi.spyOn(containerModel, 'flatten').mockImplementation(() => {
    throw new Error('flatten failed');
  });
  const spyWarn = vi.spyOn(log, 'warn');
  const spyDebug = vi.spyOn(log, 'debug');

  container.init();
  vi.runOnlyPendingTimers();

  expect(spyWarn).toHaveBeenCalledWith(
    expect.stringContaining('broken-container - Error when adding container to the metrics'),
  );
  expect(spyDebug).toHaveBeenCalled();
  spyFlatten.mockRestore();
});
