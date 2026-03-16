import { describe, expect, test } from 'vitest';
import { sortContainers, validateContainerListQuery } from './filters.js';

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
});
