import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cron from 'node-cron';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  fsWatch: vi.fn(),
  isObservationMode: vi.fn(() => false),
  gaugeSet: vi.fn(),
  getWatchContainerGauge: vi.fn(),
  parseImageListFile: vi.fn(),
  buildFileContainer: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  watch: mocks.fsWatch,
}));
vi.mock('../../../log/index.js', () => {
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
  logger.child = () => logger;
  return { default: logger };
});
vi.mock('../../../event/index.js');
vi.mock('../../../maturity/gate-watch.js', () => ({
  maybeEmitMaturityGateCleared: vi.fn().mockResolvedValue(false),
}));
vi.mock('../docker/release-notes-enrichment.js', () => ({
  enrichContainerWithReleaseNotes: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../prometheus/watcher.js', () => ({
  getWatchContainerGauge: mocks.getWatchContainerGauge,
}));
vi.mock('../../../runtime/observation-mode.js', () => ({
  isObservationMode: mocks.isObservationMode,
}));
vi.mock('../../../registry/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../registry/index.js')>()),
  getState: mocks.getState,
}));
vi.mock('./file-entries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./file-entries.js')>();
  mocks.parseImageListFile.mockImplementation(actual.parseImageListFile);
  return { ...actual, parseImageListFile: mocks.parseImageListFile };
});
vi.mock('./file-container.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./file-container.js')>();
  mocks.buildFileContainer.mockImplementation(actual.buildFileContainer);
  return { ...actual, buildFileContainer: mocks.buildFileContainer };
});

import * as event from '../../../event/index.js';
import { type Container, isFileSourcedContainer } from '../../../model/container.js';
import * as storeContainer from '../../../store/container.js';
import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import File from './File.js';
import { getFileContainerId } from './file-container.js';

const registryTags = vi.hoisted(() => ({ tags: [] as string[], error: undefined as unknown }));

let directory: string;
let listPath: string;
let db: ReturnType<typeof createMigratedMemoryDatabase>;
let watchers: File[] = [];

function writeList(content: string) {
  fs.writeFileSync(listPath, content);
}

async function createWatcher(configuration: Record<string, unknown> = {}) {
  const watcher = new File();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => logger),
  };
  watcher.log = logger as never;
  watcher.name = 'staging';
  watcher.type = 'file';
  watcher.configuration = watcher.validateConfiguration({
    path: listPath,
    ...configuration,
  } as never);
  watchers.push(watcher);
  return watcher;
}

const hub = {
  name: 'public',
  configuration: {},
  getId: () => 'hub.public',
  match: () => true,
  normalizeImage: (image: unknown) => image,
  getTags: vi.fn(async () => {
    if (registryTags.error) {
      throw registryTags.error;
    }
    return registryTags.tags;
  }),
  getImageManifestDigest: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-file-watcher-'));
  listPath = path.join(directory, 'images.yml');
  storeContainer._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  storeContainer.createCollections(db);
  registryTags.tags = ['1.25.0', '1.25.3', '1.26.0', '2.0.0'];
  registryTags.error = undefined;
  mocks.getState.mockReturnValue({ registry: { 'hub.public': hub }, trigger: {}, watcher: {} });
  mocks.isObservationMode.mockReturnValue(false);
  mocks.getWatchContainerGauge.mockReturnValue(undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const watcher of watchers) {
    await watcher.deregister();
  }
  watchers = [];
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('configuration', () => {
  test('requires a path and applies defaults', async () => {
    const watcher = await createWatcher();

    expect(watcher.configuration).toEqual({
      path: listPath,
      cron: '0 */6 * * *',
      jitter: 60000,
      watchfile: true,
    });
    expect(() => watcher.validateConfiguration({} as never)).toThrow(/path/);
    expect(() => watcher.validateConfiguration({ path: 'x', cron: 'nope' } as never)).toThrow();
    expect(() => watcher.validateConfiguration({ path: 'x', socket: '/s' } as never)).toThrow();
  });

  test('reports the next scheduled run', async () => {
    const watcher = await createWatcher({ cron: '0 0 * * *' });

    expect(new Date(watcher.getNextRunAt() as string).getHours()).toBe(0);
  });

  test('has no next run when the cron expression cannot be resolved', async () => {
    const watcher = await createWatcher();
    const createTask = vi.spyOn(cron, 'createTask');

    createTask.mockImplementationOnce(() => {
      throw new Error('bad cron');
    });
    expect(watcher.getNextRunAt()).toBeUndefined();

    createTask.mockImplementationOnce((_expression, callback) => {
      (callback as () => void)();
      return {
        destroy: vi.fn(),
        timeMatcher: { getNextMatch: () => undefined },
      } as never;
    });
    expect(watcher.getNextRunAt()).toBeUndefined();
  });
});

describe('reload', () => {
  test('loads a good list and describes it in the metadata', async () => {
    writeList('- nginx:1.25.0\n- image: redis:7\n  name: cache\n');
    const watcher = await createWatcher();

    await watcher.reload();

    expect((await watcher.getContainers()).map((container) => container.name)).toEqual([
      'nginx',
      'cache',
    ]);
    expect(watcher.getMetadata()).toMatchObject({
      source: 'file',
      path: listPath,
      imageCount: 2,
      lastLoadError: undefined,
    });
  });

  test('keeps the last good list when an edit does not validate, and reports it once', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    await watcher.reload();

    writeList('- nginx:1.25.0\n- image: ghcr.io/acme/app@sha256:abc\n');
    await watcher.reload();
    await watcher.reload();

    expect((await watcher.getContainers()).map((container) => container.name)).toEqual(['nginx']);
    expect(watcher.log.error).toHaveBeenCalledTimes(1);
    expect(watcher.log.error).toHaveBeenCalledWith(
      expect.stringContaining('entry 2: image "ghcr.io/acme/app@sha256:abc" is digest-pinned'),
    );
    expect(watcher.getMetadata().lastLoadError).toContain('keeping the last good list of 1 image');
  });

  test('recovers when the file is fixed', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    await watcher.reload();
    writeList('not: a list');
    await watcher.reload();

    writeList('- nginx:1.25.0\n- redis:7\n');
    await watcher.reload();

    expect(watcher.getMetadata()).toMatchObject({ imageCount: 2, lastLoadError: undefined });
    writeList('not: a list');
    await watcher.reload();
    expect(watcher.log.error).toHaveBeenCalledTimes(2);
  });

  test('starts with an empty list when the first read is bad', async () => {
    writeList('- image: ""\n');
    const watcher = await createWatcher();

    await watcher.reload();

    expect(await watcher.getContainers()).toEqual([]);
    expect(watcher.log.error).toHaveBeenCalledWith(
      expect.stringContaining('keeping the last good list of 0 image(s)'),
    );
  });

  test('keeps the last good list when the file is deleted, and reports it once', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    await watcher.reload();

    fs.rmSync(listPath);
    await watcher.reload();
    await watcher.reload();

    expect((await watcher.getContainers()).map((container) => container.name)).toEqual(['nginx']);
    expect(watcher.log.error).toHaveBeenCalledTimes(1);
    expect(watcher.log.error).toHaveBeenCalledWith(
      expect.stringContaining(`Unable to read ${listPath}`),
    );

    writeList('- nginx:1.25.0\n');
    await watcher.reload();
    expect(watcher.getMetadata().lastLoadError).toBeUndefined();
  });

  test('does not parse an unchanged file again', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();

    await watcher.reload();
    await watcher.reload();

    expect(mocks.parseImageListFile).toHaveBeenCalledTimes(1);
    expect(watcher.log.info).toHaveBeenCalledTimes(1);
  });

  test('reports an unexpected parser failure the same way', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    mocks.parseImageListFile.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    await watcher.reload();

    expect(watcher.log.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  test('deletes the stored records of entries removed from the list', async () => {
    writeList('- nginx:1.25.0\n- redis:7\n');
    const watcher = await createWatcher();
    await watcher.reload();
    await watcher.watch();
    expect(storeContainer.getContainers({ watcher: 'staging' }).map((c) => c.name)).toEqual([
      'nginx',
      'redis',
    ]);

    writeList('- nginx:1.25.0\n');
    await watcher.reload();

    expect(storeContainer.getContainers({ watcher: 'staging' }).map((c) => c.name)).toEqual([
      'nginx',
    ]);
  });
});

describe('getContainers', () => {
  test('skips an entry whose container cannot be built', async () => {
    writeList('- nginx:1.25.0\n- redis:7\n');
    const watcher = await createWatcher();
    await watcher.reload();
    mocks.buildFileContainer.mockImplementationOnce(() => {
      throw new Error('cannot build');
    });

    const containers = await watcher.getContainers();

    expect(containers.map((container) => container.name)).toEqual(['redis']);
    expect(watcher.log.warn).toHaveBeenCalledWith(
      'nginx - Unable to build the container (cannot build)',
    );
  });

  test('records how many containers it produced', async () => {
    writeList('- nginx:1.25.0\n');
    mocks.getWatchContainerGauge.mockReturnValue({ set: mocks.gaugeSet });
    const watcher = await createWatcher();
    await watcher.reload();

    await watcher.getContainers();

    expect(mocks.gaugeSet).toHaveBeenCalledWith({ type: 'file', name: 'staging' }, 1);
  });

  test('rewrites the declared fields of a stored container and keeps the rest', async () => {
    writeList('- image: nginx:1.25.0\n  labels:\n    dd.tag.include: "^1\\\\."\n');
    const watcher = await createWatcher();
    await watcher.reload();
    await watcher.watch();
    const id = getFileContainerId('staging', 'nginx');
    storeContainer.updateContainerFields(id, { status: 'kept' });

    writeList(
      '- image: nginx:1.25.0\n  labels:\n    dd.tag.include: "^2\\\\."\n    dd.display.name: Web\n',
    );
    await watcher.reload();
    const [refreshed] = await watcher.getContainers();

    expect(refreshed).toMatchObject({
      id,
      includeTags: '^2\\.',
      displayName: 'Web',
      status: 'kept',
    });
    expect(storeContainer.getContainer(id)).toMatchObject({
      includeTags: '^2\\.',
      displayName: 'Web',
    });
  });
});

describe('watch', () => {
  async function scan(list: string, configuration: Record<string, unknown> = {}) {
    writeList(list);
    const watcher = await createWatcher(configuration);
    const reports = await watcher.watch();
    return { watcher, reports };
  }

  test('detects a newer tag, stores the container and emits the reports', async () => {
    const { watcher, reports } = await scan('- image: nginx:1.25.0\n  tag:\n    family: loose\n');

    expect(reports).toHaveLength(1);
    expect(reports[0].container).toMatchObject({
      name: 'nginx',
      source: 'file',
      updateAvailable: true,
      result: { tag: '2.0.0' },
    });
    const stored = storeContainer.getContainer(getFileContainerId('staging', 'nginx'));
    expect(stored).toMatchObject({ watcher: 'staging', source: 'file', updateAvailable: true });
    expect(event.emitContainerReport).toHaveBeenCalledTimes(1);
    expect(event.emitContainerReports).toHaveBeenCalledWith(reports);
    expect(event.emitWatcherStart).toHaveBeenCalledWith(watcher);
    expect(event.emitWatcherStop).toHaveBeenCalledWith(watcher);
    expect(watcher.lastRunAt).toBeDefined();
    expect(watcher.getMetadata().lastRunAt).toBe(watcher.lastRunAt);
  });

  test('applies dd.tag.include and dd.tag.exclude from the entry', async () => {
    const { reports } = await scan(
      '- image: nginx:1.25.0\n  tag:\n    include: "^1\\\\."\n    exclude: "1.26"\n',
    );

    expect(reports[0].container.result?.tag).toBe('1.25.3');
  });

  test('applies dd.tag.transform from the entry', async () => {
    registryTags.tags = ['v1.25.0', 'v1.26.0'];

    const { reports } = await scan(
      '- image: nginx:v1.25.0\n  tag:\n    family: loose\n    transform: "^v(.*)$ => $1"\n',
    );

    expect(reports[0].container.updateAvailable).toBe(true);
    expect(reports[0].container.result?.tag).toBe('v1.26.0');
  });

  test('applies the tag family: strict only informs about a pinned tag, loose climbs it', async () => {
    registryTags.tags = ['1.25.0-alpine', '1.25.3-alpine', '1.25.3', '2.0.0'];

    // A pinned tag only gets an informational insight under the default strict family.
    const strict = await scan('- image: nginx:1.25.0-alpine\n');
    expect(strict.reports[0].container.updateAvailable).toBe(false);
    expect(strict.reports[0].container.result?.updateInsight).toBeDefined();

    storeContainer._resetContainerStoreStateForTests();
    storeContainer.createCollections(db);
    const loose = await scan('- image: nginx:1.25.0-alpine\n  tag:\n    family: loose\n');
    expect(loose.reports[0].container.result?.tag).toBe('1.25.3-alpine');
    expect(loose.reports[0].container.updateAvailable).toBe(true);
  });

  test('carries trigger routing labels to the stored container', async () => {
    await scan(
      `- image: nginx:1.25.0
  labels:
    dd.notification.include: slack.team
    dd.notification.exclude: smtp.ops
    dd.action.exclude: docker.local
`,
    );

    expect(storeContainer.getContainer(getFileContainerId('staging', 'nginx'))).toMatchObject({
      notificationTriggerInclude: 'slack.team',
      notificationTriggerExclude: 'smtp.ops',
      actionTriggerExclude: 'docker.local',
    });
  });

  test('records the error on the container when the registry lookup fails', async () => {
    registryTags.error = new Error('registry down');

    const { reports } = await scan('- nginx:1.25.0\n');

    expect(reports[0].container.error).toEqual({ message: 'registry down' });
  });

  test('falls back to an error report when a container scan rejects', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    vi.spyOn(watcher, 'watchContainer').mockRejectedValueOnce(new Error('scan failed'));

    const reports = await watcher.watch();

    expect(reports).toHaveLength(1);
    expect(reports[0].container.error).toEqual({ message: 'scan failed' });
    expect(event.emitContainerReport).toHaveBeenCalledWith(reports[0]);
    expect(watcher.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Error when processing container staging_nginx (scan failed)'),
    );
  });

  test('re-reads the file at the start of a scan', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    await watcher.watch();

    writeList('- nginx:1.25.0\n- redis:7\n');
    const reports = await watcher.watch();

    expect(reports.map((report) => report.container.name)).toEqual(['nginx', 'redis']);
  });

  test('discards the results of a scan the watcher was deregistered during', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    vi.spyOn(watcher, 'watchContainer').mockImplementationOnce(async (container) => {
      await watcher.deregister();
      return { container, changed: false };
    });

    expect(await watcher.watch()).toEqual([]);
    expect(event.emitContainerReports).not.toHaveBeenCalled();
  });

  test('discards the results when the watcher is deregistered while emitting them', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    vi.mocked(event.emitContainerReports).mockImplementationOnce(async () => {
      await watcher.deregister();
    });

    expect(await watcher.watch()).toEqual([]);
    expect(watcher.lastRunAt).toBeUndefined();
  });

  test('refuses to apply a scan result once the watcher is deregistered', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    await watcher.reload();
    const [container] = await watcher.getContainers();
    const scanGeneration = 0;
    await watcher.deregister();

    const report = await watcher.watchContainer(container, { scanGeneration });

    expect(report.changed).toBe(false);
    expect(storeContainer.getContainer(container.id)).toBeUndefined();
  });

  test('scans a single container on request and emits the batch event', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    await watcher.reload();
    const [container] = await watcher.getContainers();

    const report = await watcher.watchContainer(container, { emitBatchEvent: true });

    expect(report.container.name).toBe('nginx');
    expect(event.emitContainerReports).toHaveBeenCalledWith([report]);
  });

  test('skips the stored skip list lookup when the container was never stored', async () => {
    writeList('- image: nginx:1.25.0\n  tag:\n    family: loose\n');
    const watcher = await createWatcher();
    await watcher.reload();
    const [container] = await watcher.getContainers();

    const result = await watcher.findNewVersion(container as Container, {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });

    expect(result.tag).toBe('2.0.0');
  });

  test('honours a tag skipped on the stored container', async () => {
    const { watcher } = await scan('- image: nginx:1.25.0\n  tag:\n    family: loose\n');
    const id = getFileContainerId('staging', 'nginx');
    storeContainer.updateContainerFields(id, {
      updatePolicy: { skipTags: ['major:2'] },
      updatePolicyOverrides: { skipTags: ['major:2'] },
    });

    const [container] = await watcher.getContainers();
    const result = await watcher.findNewVersion(container as Container, {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });

    expect(result.tag).toBe('1.26.0');
  });
});

describe('watchFromCron', () => {
  test('answers with nothing once deregistered', async () => {
    const watcher = await createWatcher();
    await watcher.deregister();

    expect(await watcher.watchFromCron({ reason: 'late' })).toEqual([]);
  });

  test('coalesces requests made during a scan into one follow-up', async () => {
    writeList('- nginx:1.25.0\n');
    const watcher = await createWatcher();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const watch = vi
      .spyOn(watcher, 'watch')
      .mockImplementationOnce(async () => {
        await gate;
        return [];
      })
      .mockRejectedValueOnce(new Error('follow-up failed'));

    const first = watcher.watchFromCron({ reason: 'schedule' });
    const second = watcher.watchFromCron({ ignoreMaintenanceWindow: true, reason: 'manual' });
    const third = watcher.watchFromCron();

    expect(second).toBe(first);
    expect(third).toBe(first);
    release();
    await first;
    await vi.waitFor(() => expect(watch).toHaveBeenCalledTimes(2));
    expect(watcher.cronWatchInFlight).toBeUndefined();
  });

  test('does not follow up when nothing was requested during the scan', async () => {
    const watcher = await createWatcher();
    const watch = vi.spyOn(watcher, 'watch').mockResolvedValue([]);

    await watcher.watchFromCron();
    await Promise.resolve();

    expect(watch).toHaveBeenCalledTimes(1);
    expect(watcher.cronWatchInFlight).toBeUndefined();
  });

  test('does not clear the in-flight scan of a newer one', async () => {
    const watcher = await createWatcher();
    vi.spyOn(watcher, 'watch').mockResolvedValue([]);

    const scan = watcher.watchFromCron();
    watcher.cronWatchInFlight = Promise.resolve([]);
    const newer = watcher.cronWatchInFlight;
    await scan;

    expect(watcher.cronWatchInFlight).toBe(newer);
  });
});

describe('init and deregister', () => {
  function fakeFsWatcher() {
    const emitter = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> };
    emitter.close = vi.fn();
    mocks.fsWatch.mockReturnValue(emitter);
    return emitter;
  }

  function lastFsListener() {
    return mocks.fsWatch.mock.calls.at(-1)?.[2] as (eventType: string, name: string | null) => void;
  }

  test('loads the file, schedules the scans and watches the directory', async () => {
    vi.useFakeTimers();
    writeList('- nginx:1.25.0\n');
    const stop = vi.fn();
    const schedule = vi.spyOn(cron, 'schedule').mockReturnValue({ stop } as never);
    const emitter = fakeFsWatcher();
    const watcher = await createWatcher({ jitter: 5 });
    const watch = vi.spyOn(watcher, 'watch').mockResolvedValue([]);

    await watcher.init();

    expect(watcher.getMetadata().imageCount).toBe(1);
    expect(schedule).toHaveBeenCalledWith('0 */6 * * *', expect.any(Function), {
      maxRandomDelay: 5,
    });
    expect(mocks.fsWatch).toHaveBeenCalledWith(
      directory,
      { persistent: false },
      expect.any(Function),
    );

    // the scheduled callback and the startup scan both go through watchFromCron
    (schedule.mock.calls[0][1] as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(watch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(watch).toHaveBeenCalledTimes(2);

    await watcher.deregister();
    expect(stop).toHaveBeenCalled();
    expect(emitter.close).toHaveBeenCalled();
    expect(watcher.watchCron).toBeUndefined();
    expect(watcher.watchCronTimeout).toBeUndefined();
    expect(watcher.fileWatcher).toBeUndefined();
  });

  test('swallows a failing scheduled or startup scan', async () => {
    vi.useFakeTimers();
    writeList('- nginx:1.25.0\n');
    vi.spyOn(cron, 'schedule').mockReturnValue({ stop: vi.fn() } as never);
    const watcher = await createWatcher({ watchfile: false });
    vi.spyOn(watcher, 'watch').mockRejectedValue(new Error('scan failed'));

    await watcher.init();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.fsWatch).not.toHaveBeenCalled();
  });

  test('re-scans shortly after the file changes, once per burst', async () => {
    vi.useFakeTimers();
    writeList('- nginx:1.25.0\n');
    vi.spyOn(cron, 'schedule').mockReturnValue({ stop: vi.fn() } as never);
    fakeFsWatcher();
    const watcher = await createWatcher();
    const watch = vi.spyOn(watcher, 'watch').mockResolvedValue([]);
    await watcher.init();
    await vi.advanceTimersByTimeAsync(1000);
    watch.mockClear();

    const listener = lastFsListener();
    listener('change', 'other.yml');
    await vi.advanceTimersByTimeAsync(2000);
    expect(watch).not.toHaveBeenCalled();

    listener('rename', 'images.yml');
    listener('change', 'images.yml');
    listener('change', null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(watch).toHaveBeenCalledTimes(1);
  });

  test('treats a missing file name in a change event as a change to the file', async () => {
    vi.useFakeTimers();
    writeList('- nginx:1.25.0\n');
    vi.spyOn(cron, 'schedule').mockReturnValue({ stop: vi.fn() } as never);
    fakeFsWatcher();
    const watcher = await createWatcher();
    const watch = vi.spyOn(watcher, 'watch').mockResolvedValue([]);
    await watcher.init();
    await vi.advanceTimersByTimeAsync(1000);
    watch.mockClear();

    lastFsListener()('change', undefined as never);
    await vi.advanceTimersByTimeAsync(1000);

    expect(watch).toHaveBeenCalledTimes(1);
  });

  test('ignores a file change that lands after deregistration and swallows scan failures', async () => {
    vi.useFakeTimers();
    writeList('- nginx:1.25.0\n');
    vi.spyOn(cron, 'schedule').mockReturnValue({ stop: vi.fn() } as never);
    fakeFsWatcher();
    const watcher = await createWatcher();
    const watch = vi.spyOn(watcher, 'watch').mockRejectedValue(new Error('scan failed'));
    await watcher.init();
    await vi.advanceTimersByTimeAsync(1000);
    watch.mockClear();

    lastFsListener()('change', 'images.yml');
    await vi.advanceTimersByTimeAsync(1000);
    expect(watch).toHaveBeenCalledTimes(1);

    lastFsListener()('change', 'images.yml');
    await watcher.deregister();
    await vi.advanceTimersByTimeAsync(1000);
    expect(watch).toHaveBeenCalledTimes(1);
  });

  test('logs a directory watch failure and keeps running on the cron', async () => {
    vi.useFakeTimers();
    writeList('- nginx:1.25.0\n');
    vi.spyOn(cron, 'schedule').mockReturnValue({ stop: vi.fn() } as never);
    const emitter = fakeFsWatcher();
    const watcher = await createWatcher();
    vi.spyOn(watcher, 'watch').mockResolvedValue([]);
    await watcher.init();

    emitter.emit('error', new Error('inotify limit'));
    expect(watcher.log.warn).toHaveBeenCalledWith(
      `File watch on ${directory} failed (inotify limit)`,
    );

    mocks.fsWatch.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const other = await createWatcher();
    vi.spyOn(other, 'watch').mockResolvedValue([]);
    await other.init();
    expect(other.log.warn).toHaveBeenCalledWith(
      expect.stringContaining(`Unable to watch ${directory} for changes (ENOENT)`),
    );
    expect(other.fileWatcher).toBeUndefined();
  });

  test('a one-shot scan loads the file but schedules nothing', async () => {
    writeList('- nginx:1.25.0\n');
    mocks.isObservationMode.mockReturnValue(true);
    const schedule = vi.spyOn(cron, 'schedule');
    const watcher = await createWatcher();

    await watcher.init();

    expect(watcher.getMetadata().imageCount).toBe(1);
    expect(schedule).not.toHaveBeenCalled();
    expect(mocks.fsWatch).not.toHaveBeenCalled();
  });

  test('re-registering clears the deregistered flag', async () => {
    writeList('- nginx:1.25.0\n');
    mocks.isObservationMode.mockReturnValue(true);
    const watcher = await createWatcher();
    await watcher.deregister();
    expect(watcher.isWatcherDeregistered).toBe(true);

    await watcher.init();

    expect(watcher.isWatcherDeregistered).toBe(false);
    expect(isFileSourcedContainer((await watcher.getContainers())[0])).toBe(true);
  });
});
