import { describe, expect, test, vi } from 'vitest';
import type { Container } from '../../model/container.js';
import {
  applyContainerMaturityFilter,
  applyContainerWatchedKindFilter,
  isContainerRuntimeStatus,
  isContainerWatchedKind,
  mapContainerListKindFilter,
  mapContainerListStatusFilter,
  removeContainerListControlParams,
  resolveContainerSortMode,
  sortContainers,
  validateContainerListQuery,
} from './filters.js';

describe('api/container/filters', () => {
  test('normalizes -status sort mode before sorting', () => {
    const sorted = sortContainers(
      [
        { id: 'c1', name: 'alpha', updateAvailable: true },
        { id: 'c2', name: 'beta', updateAvailable: false },
      ] as any,
      '-status',
    );

    expect(sorted.map((container) => container.id)).toEqual(['c2', 'c1']);
  });

  test('normalizes -age sort mode before sorting', () => {
    const sorted = sortContainers(
      [
        { id: 'c1', name: 'alpha', updateAge: 120_000 },
        { id: 'c2', name: 'beta', updateAge: 60_000 },
      ] as any,
      '-age',
    );

    expect(sorted.map((container) => container.id)).toEqual(['c2', 'c1']);
  });

  test('computes update age once per container when sorting by age', () => {
    const parseSpy = vi.spyOn(Date, 'parse');
    const containers = Array.from({ length: 12 }, (_, index) => ({
      id: `c${index + 1}`,
      name: `container-${index + 1}`,
      firstSeenAt: `2024-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));

    try {
      sortContainers(containers as any, 'age');
      expect(parseSpy).toHaveBeenCalledTimes(containers.length * 3);
    } finally {
      parseSpy.mockRestore();
    }
  });

  test('computes created timestamps once per container when sorting by created', () => {
    const parseSpy = vi.spyOn(Date, 'parse');
    const containers = Array.from({ length: 12 }, (_, index) => ({
      id: `c${index + 1}`,
      name: `container-${index + 1}`,
      image: { created: `2024-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` },
    }));

    try {
      sortContainers(containers as any, 'created');
      expect(parseSpy).toHaveBeenCalledTimes(containers.length);
    } finally {
      parseSpy.mockRestore();
    }
  });

  test('reads UI maturity threshold once when applying maturity filter', () => {
    const originalEnv = process.env;
    let thresholdReads = 0;
    const proxiedEnv = new Proxy(originalEnv, {
      get(target, property, receiver) {
        if (property === 'DD_UI_MATURITY_THRESHOLD_DAYS') {
          thresholdReads++;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    process.env = proxiedEnv as NodeJS.ProcessEnv;
    const containers = Array.from({ length: 12 }, (_, index) => ({
      id: `c${index + 1}`,
      name: `container-${index + 1}`,
      updateAge: 0,
    }));

    try {
      applyContainerMaturityFilter(containers as any, 'hot');
      expect(thresholdReads).toBe(1);
    } finally {
      process.env = originalEnv;
    }
  });

  test('normalizes -created sort mode before sorting', () => {
    const sorted = sortContainers(
      [
        { id: 'c1', name: 'alpha', image: { created: '2024-01-01T00:00:00.000Z' } },
        { id: 'c2', name: 'beta', image: { created: '2023-01-01T00:00:00.000Z' } },
      ] as any,
      '-created',
    );

    expect(sorted.map((container) => container.id)).toEqual(['c1', 'c2']);
  });

  test('sorts status mode by update availability before name', () => {
    const sorted = sortContainers(
      [
        { id: 'c1', name: 'alpha', updateAvailable: false },
        { id: 'c2', name: 'beta', updateAvailable: true },
      ] as any,
      'status',
    );

    expect(sorted.map((container) => container.id)).toEqual(['c2', 'c1']);
  });

  test('sorts created mode with valid timestamps before invalid timestamps', () => {
    const sorted = sortContainers(
      [
        { id: 'c1', name: 'alpha', image: { created: 'invalid-date' } },
        { id: 'c2', name: 'beta', image: { created: '2024-01-01T00:00:00.000Z' } },
      ] as any,
      'created',
    );

    expect(sorted.map((container) => container.id)).toEqual(['c2', 'c1']);
  });

  test('sorts created mode with valid timestamps before invalid timestamps in reverse order', () => {
    const sorted = sortContainers(
      [
        { id: 'c1', name: 'alpha', image: { created: '2024-01-01T00:00:00.000Z' } },
        { id: 'c2', name: 'beta', image: { created: 'invalid-date' } },
      ] as any,
      'created',
    );

    expect(sorted.map((container) => container.id)).toEqual(['c1', 'c2']);
  });

  test('supports descending name sort mode', () => {
    const sorted = sortContainers(
      [
        { id: 'c1', name: 'alpha' },
        { id: 'c2', name: 'beta' },
      ] as any,
      '-name',
    );

    expect(sorted.map((container) => container.id)).toEqual(['c2', 'c1']);
  });

  test('supports ascending name sort mode', () => {
    const sorted = sortContainers(
      [
        { id: 'c1', name: 'beta' },
        { id: 'c2', name: 'alpha' },
      ] as any,
      'name',
    );

    expect(sorted.map((container) => container.id)).toEqual(['c2', 'c1']);
  });

  test('validateContainerListQuery accepts all supported sort modes', () => {
    const supportedSortModes = [
      'name',
      '-name',
      'status',
      '-status',
      'age',
      '-age',
      'created',
      '-created',
    ];

    for (const sortMode of supportedSortModes) {
      expect(validateContainerListQuery({ sort: sortMode } as any).sortMode).toBe(sortMode);
    }
  });

  test('validateContainerListQuery throws schema validation details for invalid sort', () => {
    expect(() => validateContainerListQuery({ sort: 'invalid-sort' } as any)).toThrow(
      'Invalid sort value',
    );
  });

  test('validateContainerListQuery accepts update status values', () => {
    expect(validateContainerListQuery({ status: 'update-available' } as any).status).toBe(
      'update-available',
    );
    expect(validateContainerListQuery({ status: 'up-to-date' } as any).status).toBe('up-to-date');
  });

  test('validateContainerListQuery accepts Docker runtime status values', () => {
    const runtimeStatuses = [
      'running',
      'stopped',
      'exited',
      'paused',
      'restarting',
      'dead',
      'created',
    ];
    for (const status of runtimeStatuses) {
      expect(validateContainerListQuery({ status } as any).status).toBe(status);
    }
  });

  test('validateContainerListQuery throws for invalid status values', () => {
    expect(() => validateContainerListQuery({ status: 'active' } as any)).toThrow(
      'Invalid status filter value',
    );
  });

  test('isContainerRuntimeStatus identifies runtime status values', () => {
    expect(isContainerRuntimeStatus('running')).toBe(true);
    expect(isContainerRuntimeStatus('stopped')).toBe(true);
    expect(isContainerRuntimeStatus('exited')).toBe(true);
    expect(isContainerRuntimeStatus('paused')).toBe(true);
    expect(isContainerRuntimeStatus('restarting')).toBe(true);
    expect(isContainerRuntimeStatus('dead')).toBe(true);
    expect(isContainerRuntimeStatus('created')).toBe(true);
    expect(isContainerRuntimeStatus('update-available')).toBe(false);
    expect(isContainerRuntimeStatus('up-to-date')).toBe(false);
    expect(isContainerRuntimeStatus('active')).toBe(false);
    expect(isContainerRuntimeStatus(undefined)).toBe(false);
    expect(isContainerRuntimeStatus(null)).toBe(false);
  });

  test('mapContainerListStatusFilter maps update status to updateAvailable', () => {
    expect(mapContainerListStatusFilter('update-available')).toEqual({ updateAvailable: true });
    expect(mapContainerListStatusFilter('up-to-date')).toEqual({ updateAvailable: false });
  });

  test('mapContainerListStatusFilter maps runtime status to runtimeStatus', () => {
    expect(mapContainerListStatusFilter('running')).toEqual({ runtimeStatus: 'running' });
    expect(mapContainerListStatusFilter('exited')).toEqual({ runtimeStatus: 'exited' });
    expect(mapContainerListStatusFilter('stopped')).toEqual({ runtimeStatus: 'stopped' });
  });

  test('mapContainerListStatusFilter returns undefined for unknown values', () => {
    expect(mapContainerListStatusFilter('unknown-value')).toBeUndefined();
    expect(mapContainerListStatusFilter(undefined)).toBeUndefined();
    expect(mapContainerListStatusFilter('')).toBeUndefined();
  });

  test('resolveContainerSortMode returns ascending sort when order is asc', () => {
    expect(resolveContainerSortMode('name', 'asc')).toBe('name');
    expect(resolveContainerSortMode('status', 'asc')).toBe('status');
    expect(resolveContainerSortMode('age', 'asc')).toBe('age');
    expect(resolveContainerSortMode('created', 'asc')).toBe('created');
  });

  test('resolveContainerSortMode returns descending sort when order is desc', () => {
    expect(resolveContainerSortMode('name', 'desc')).toBe('-name');
    expect(resolveContainerSortMode('status', 'desc')).toBe('-status');
    expect(resolveContainerSortMode('age', 'desc')).toBe('-age');
    expect(resolveContainerSortMode('created', 'desc')).toBe('-created');
  });

  test('resolveContainerSortMode order=asc overrides prefix-based descending sort', () => {
    expect(resolveContainerSortMode('-name', 'asc')).toBe('name');
    expect(resolveContainerSortMode('-status', 'asc')).toBe('status');
    expect(resolveContainerSortMode('-age', 'asc')).toBe('age');
    expect(resolveContainerSortMode('-created', 'asc')).toBe('created');
  });

  test('resolveContainerSortMode order=desc overrides prefix-based ascending sort', () => {
    expect(resolveContainerSortMode('name', 'desc')).toBe('-name');
    expect(resolveContainerSortMode('status', 'desc')).toBe('-status');
  });

  test('resolveContainerSortMode preserves prefix when no order is given', () => {
    expect(resolveContainerSortMode('-name', undefined)).toBe('-name');
    expect(resolveContainerSortMode('name', undefined)).toBe('name');
    expect(resolveContainerSortMode('-status', '')).toBe('-status');
  });

  test('resolveContainerSortMode defaults to name when sort is invalid', () => {
    expect(resolveContainerSortMode('invalid', 'desc')).toBe('-name');
    expect(resolveContainerSortMode(undefined, 'asc')).toBe('name');
    expect(resolveContainerSortMode(undefined, undefined)).toBe('name');
  });

  test('validateContainerListQuery resolves sort + order into sortMode', () => {
    expect(validateContainerListQuery({ sort: 'name', order: 'desc' } as any).sortMode).toBe(
      '-name',
    );
    expect(validateContainerListQuery({ sort: 'status', order: 'asc' } as any).sortMode).toBe(
      'status',
    );
    expect(validateContainerListQuery({ sort: 'age', order: 'desc' } as any).sortMode).toBe('-age');
    expect(validateContainerListQuery({ sort: 'created', order: 'asc' } as any).sortMode).toBe(
      'created',
    );
  });

  test('validateContainerListQuery accepts order without sort', () => {
    expect(validateContainerListQuery({ order: 'desc' } as any).sortMode).toBe('-name');
    expect(validateContainerListQuery({ order: 'asc' } as any).sortMode).toBe('name');
  });

  test('validateContainerListQuery throws for invalid order value', () => {
    expect(() => validateContainerListQuery({ order: 'ascending' } as any)).toThrow(
      'Invalid order value',
    );
  });

  test('removeContainerListControlParams strips order from query', () => {
    const query = { sort: 'name', order: 'asc', name: 'nginx' } as any;
    const result = removeContainerListControlParams(query);
    expect(result).toEqual({ name: 'nginx' });
    expect(result).not.toHaveProperty('sort');
    expect(result).not.toHaveProperty('order');
  });

  test('validateContainerListQuery accepts watched kind values', () => {
    expect(validateContainerListQuery({ kind: 'watched' } as any).kind).toBe('watched');
    expect(validateContainerListQuery({ kind: 'unwatched' } as any).kind).toBe('unwatched');
    expect(validateContainerListQuery({ kind: 'all' } as any).kind).toBe('all');
  });

  test('validateContainerListQuery still accepts update kind values', () => {
    expect(validateContainerListQuery({ kind: 'major' } as any).kind).toBe('major');
    expect(validateContainerListQuery({ kind: 'minor' } as any).kind).toBe('minor');
    expect(validateContainerListQuery({ kind: 'patch' } as any).kind).toBe('patch');
    expect(validateContainerListQuery({ kind: 'digest' } as any).kind).toBe('digest');
  });

  test('validateContainerListQuery throws for invalid kind values', () => {
    expect(() => validateContainerListQuery({ kind: 'invalid-kind' } as any)).toThrow(
      'Invalid kind filter value',
    );
  });

  test('isContainerWatchedKind identifies watched kind values', () => {
    expect(isContainerWatchedKind('watched')).toBe(true);
    expect(isContainerWatchedKind('unwatched')).toBe(true);
    expect(isContainerWatchedKind('all')).toBe(true);
    expect(isContainerWatchedKind('major')).toBe(false);
    expect(isContainerWatchedKind('minor')).toBe(false);
    expect(isContainerWatchedKind('digest')).toBe(false);
    expect(isContainerWatchedKind(undefined)).toBe(false);
    expect(isContainerWatchedKind(null)).toBe(false);
    expect(isContainerWatchedKind('')).toBe(false);
  });

  test('mapContainerListKindFilter returns undefined for watched kind values', () => {
    expect(mapContainerListKindFilter('watched')).toBeUndefined();
    expect(mapContainerListKindFilter('unwatched')).toBeUndefined();
    expect(mapContainerListKindFilter('all')).toBeUndefined();
  });

  test('mapContainerListKindFilter still maps update kind values', () => {
    expect(mapContainerListKindFilter('digest')).toEqual({ 'updateKind.kind': 'digest' });
    expect(mapContainerListKindFilter('major')).toEqual({ 'updateKind.semverDiff': 'major' });
    expect(mapContainerListKindFilter('minor')).toEqual({ 'updateKind.semverDiff': 'minor' });
    expect(mapContainerListKindFilter('patch')).toEqual({ 'updateKind.semverDiff': 'patch' });
  });

  test('applyContainerWatchedKindFilter returns all containers when kind is all', () => {
    const containers = [
      { id: 'c1', labels: { 'dd.watch': 'true' } },
      { id: 'c2', labels: {} },
    ] as unknown as Container[];
    expect(applyContainerWatchedKindFilter(containers, 'all').map((c) => c.id)).toEqual([
      'c1',
      'c2',
    ]);
  });

  test('applyContainerWatchedKindFilter returns all containers when kind is undefined', () => {
    const containers = [
      { id: 'c1', labels: { 'dd.watch': 'true' } },
      { id: 'c2', labels: {} },
    ] as unknown as Container[];
    expect(applyContainerWatchedKindFilter(containers, undefined).map((c) => c.id)).toEqual([
      'c1',
      'c2',
    ]);
  });

  test('applyContainerWatchedKindFilter returns only watched containers when kind is watched', () => {
    const containers = [
      { id: 'c1', labels: { 'dd.watch': 'true' } },
      { id: 'c2', labels: {} },
      { id: 'c3', labels: { 'dd.watch': 'false' } },
      { id: 'c4', labels: { 'dd.watch': 'True' } },
    ] as unknown as Container[];
    expect(applyContainerWatchedKindFilter(containers, 'watched').map((c) => c.id)).toEqual([
      'c1',
      'c4',
    ]);
  });

  test('applyContainerWatchedKindFilter returns only unwatched containers when kind is unwatched', () => {
    const containers = [
      { id: 'c1', labels: { 'dd.watch': 'true' } },
      { id: 'c2', labels: {} },
      { id: 'c3', labels: { 'dd.watch': 'false' } },
      { id: 'c4' },
    ] as unknown as Container[];
    expect(applyContainerWatchedKindFilter(containers, 'unwatched').map((c) => c.id)).toEqual([
      'c2',
      'c3',
      'c4',
    ]);
  });

  test('applyContainerWatchedKindFilter recognizes wud.watch legacy label', () => {
    const containers = [
      { id: 'c1', labels: { 'wud.watch': 'true' } },
      { id: 'c2', labels: { 'wud.watch': 'false' } },
    ] as unknown as Container[];
    expect(applyContainerWatchedKindFilter(containers, 'watched').map((c) => c.id)).toEqual(['c1']);
    expect(applyContainerWatchedKindFilter(containers, 'unwatched').map((c) => c.id)).toEqual([
      'c2',
    ]);
  });

  test('applyContainerWatchedKindFilter prefers dd.watch over wud.watch', () => {
    const containers = [
      { id: 'c1', labels: { 'dd.watch': 'true', 'wud.watch': 'false' } },
      { id: 'c2', labels: { 'dd.watch': 'false', 'wud.watch': 'true' } },
    ] as unknown as Container[];
    expect(applyContainerWatchedKindFilter(containers, 'watched').map((c) => c.id)).toEqual(['c1']);
    expect(applyContainerWatchedKindFilter(containers, 'unwatched').map((c) => c.id)).toEqual([
      'c2',
    ]);
  });

  test('applyContainerWatchedKindFilter treats containers without labels as unwatched', () => {
    const containers = [
      { id: 'c1' },
      { id: 'c2', labels: undefined },
      { id: 'c3', labels: null },
    ] as unknown as Container[];
    expect(applyContainerWatchedKindFilter(containers, 'watched')).toEqual([]);
    expect(applyContainerWatchedKindFilter(containers, 'unwatched').map((c) => c.id)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
  });
});
