import { describe, expect, test } from 'vitest';
import {
  isContainerRuntimeStatus,
  mapContainerListStatusFilter,
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
});
