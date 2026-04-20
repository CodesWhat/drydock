import { describe, expect, test } from 'vitest';
import {
  buildContainerStatsByKey,
  createEmptyContainerStatsBucket,
  getContainerStatusSummary,
  isContainerRunning,
  projectStatsBucket,
} from './container-summary.js';

describe('isContainerRunning', () => {
  test('matches running status case-insensitively', () => {
    expect(isContainerRunning({ status: 'running' })).toBe(true);
    expect(isContainerRunning({ status: 'RUNNING' })).toBe(true);
  });

  test('treats missing or non-running status as false', () => {
    expect(isContainerRunning({ status: 'paused' })).toBe(false);
    expect(isContainerRunning({ status: undefined })).toBe(false);
    expect(isContainerRunning({})).toBe(false);
  });
});

describe('getContainerStatusSummary', () => {
  test('returns total, running, stopped, and updatesAvailable counts', () => {
    expect(
      getContainerStatusSummary([
        { status: 'running', updateAvailable: true },
        { status: 'exited', updateAvailable: false },
        { status: 'RUNNING', updateAvailable: true },
        {},
      ]),
    ).toEqual({
      total: 4,
      running: 2,
      stopped: 2,
      updatesAvailable: 2,
    });
  });

  test('returns zero updatesAvailable when no containers have updates', () => {
    expect(
      getContainerStatusSummary([
        { status: 'running', updateAvailable: false },
        { status: 'running' },
      ]),
    ).toEqual({
      total: 2,
      running: 2,
      stopped: 0,
      updatesAvailable: 0,
    });
  });
});

describe('createEmptyContainerStatsBucket', () => {
  test('returns a fresh zeroed bucket with an empty fingerprint set', () => {
    const bucket = createEmptyContainerStatsBucket();
    expect(bucket.total).toBe(0);
    expect(bucket.running).toBe(0);
    expect(bucket.updatesAvailable).toBe(0);
    expect(bucket.imageFingerprints.size).toBe(0);
    const other = createEmptyContainerStatsBucket();
    other.imageFingerprints.add('x');
    expect(bucket.imageFingerprints.size).toBe(0);
  });
});

describe('buildContainerStatsByKey', () => {
  test('attributes each container to a single bucket in one pass', () => {
    const containers = [
      { id: 'c1', watcher: 'alpha', status: 'running', updateAvailable: true, image: { id: 'a' } },
      { id: 'c2', watcher: 'alpha', status: 'exited', updateAvailable: false, image: { id: 'a' } },
      { id: 'c3', watcher: 'beta', status: 'running', updateAvailable: false, image: { id: 'b' } },
      { id: 'c4', watcher: 'alpha', status: 'running', updateAvailable: false, image: { id: 'c' } },
    ];
    const byKey = buildContainerStatsByKey(containers, ['alpha', 'beta', 'gamma'], (c) =>
      typeof c.watcher === 'string' ? c.watcher : undefined,
    );
    expect(byKey.get('alpha')).toMatchObject({
      total: 3,
      running: 2,
      updatesAvailable: 1,
    });
    expect(byKey.get('alpha')?.imageFingerprints.size).toBe(2);
    expect(byKey.get('beta')).toMatchObject({
      total: 1,
      running: 1,
      updatesAvailable: 0,
    });
    expect(byKey.get('gamma')).toMatchObject({ total: 0, running: 0, updatesAvailable: 0 });
  });

  test('skips containers when getKey returns undefined', () => {
    const containers = [
      { id: 'c1', status: 'running', image: { id: 'a' } },
      { id: 'c2', watcher: 'alpha', status: 'running', image: { id: 'b' } },
    ];
    const byKey = buildContainerStatsByKey(containers, ['alpha'], (c) =>
      typeof c.watcher === 'string' ? c.watcher : undefined,
    );
    expect(byKey.get('alpha')?.total).toBe(1);
  });

  test('ignores containers whose key is not in the preallocated key list', () => {
    const containers = [
      { id: 'c1', watcher: 'unknown', status: 'running', image: { id: 'a' } },
      { id: 'c2', watcher: 'alpha', status: 'running', image: { id: 'b' } },
    ];
    const byKey = buildContainerStatsByKey(containers, ['alpha'], (c) =>
      typeof c.watcher === 'string' ? c.watcher : undefined,
    );
    expect(byKey.size).toBe(1);
    expect(byKey.get('alpha')?.total).toBe(1);
  });

  test('falls back through image.id, image.name, and container.id for fingerprints', () => {
    const containers = [
      { id: 'c-with-image-id', watcher: 'a', status: 'running', image: { id: 'img-1' } },
      { id: 'c-with-image-name', watcher: 'a', status: 'running', image: { name: 'img-2' } },
      { id: 'c-no-image', watcher: 'a', status: 'running', image: null },
      { id: '', watcher: 'a', status: 'running', image: { id: '' } },
      { id: 42, watcher: 'a', status: 'running', image: { id: 42 } },
    ];
    const byKey = buildContainerStatsByKey(containers, ['a'], (c) =>
      typeof c.watcher === 'string' ? c.watcher : undefined,
    );
    const bucket = byKey.get('a');
    expect(bucket?.imageFingerprints.has('img-1')).toBe(true);
    expect(bucket?.imageFingerprints.has('img-2')).toBe(true);
    expect(bucket?.imageFingerprints.has('c-no-image')).toBe(true);
    expect(bucket?.imageFingerprints.has('')).toBe(false);
    expect(bucket?.imageFingerprints.size).toBe(3);
  });
});

describe('projectStatsBucket', () => {
  test('derives stopped from total - running and projects to the public shape', () => {
    const bucket = createEmptyContainerStatsBucket();
    bucket.total = 5;
    bucket.running = 3;
    bucket.updatesAvailable = 2;
    bucket.imageFingerprints.add('a');
    bucket.imageFingerprints.add('b');
    expect(projectStatsBucket(bucket)).toEqual({
      containers: { total: 5, running: 3, stopped: 2, updatesAvailable: 2 },
      images: 2,
    });
  });

  test('clamps stopped to zero when running exceeds total', () => {
    const bucket = createEmptyContainerStatsBucket();
    bucket.total = 1;
    bucket.running = 5;
    expect(projectStatsBucket(bucket).containers.stopped).toBe(0);
  });
});
