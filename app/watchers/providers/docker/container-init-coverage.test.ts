import { describe, expect, test, vi } from 'vitest';
import {
  filterRecreatedContainerAliases,
  getLabel,
  getMatchingImgsetConfiguration,
} from './container-init.js';

vi.mock('../../../log/index.js', () => ({
  default: {
    warn: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('../../../store/container.js', () => ({
  deleteContainer: vi.fn(),
  getContainer: vi.fn(),
  getContainers: vi.fn(),
  getContainersRaw: vi.fn(),
  insertContainer: vi.fn(),
  updateContainer: vi.fn(),
}));

vi.mock('../../../prometheus/compatibility.js', () => ({
  recordLegacyInput: vi.fn(),
}));

function createIterableNames(name: string) {
  return {
    length: 1,
    [Symbol.iterator]: function* () {
      yield name;
    },
  };
}

describe('container-init coverage', () => {
  test('filterRecreatedContainerAliases covers blank Created and non-array Names fallback', () => {
    const aliasName = '/7ea6b8a42686_termix';
    const container = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
      Names: [aliasName],
      Created: '',
    } as any;

    const result = filterRecreatedContainerAliases([container], []);

    // Alias detected, but stale (blank Created) with no sibling/store match → allowed
    expect(result.containersToWatch).toEqual([container]);
    expect(result.skippedContainerIds.size).toBe(0);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        containerId: container.Id,
        containerName: 'termix',
        baseName: 'termix',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
      }),
    ]);
  });

  test('filterRecreatedContainerAliases handles non-string entries while building the name map', () => {
    const container = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a12',
      Names: ['/termix', 123 as any],
      Created: Math.floor((Date.now() - 120_000) / 1000),
    } as any;

    const result = filterRecreatedContainerAliases([container], []);

    expect(result.containersToWatch).toEqual([container]);
    expect(result.skippedContainerIds.size).toBe(0);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        containerId: container.Id,
        containerName: 'termix',
        decision: 'allowed',
        reason: 'not-recreated-alias',
      }),
    ]);
  });

  test('filterRecreatedContainerAliases uses unknown display name when no docker names are present', () => {
    const container = {
      Id: 'plain-container-id',
      Names: [],
    } as any;

    const result = filterRecreatedContainerAliases([container], []);

    expect(result.containersToWatch).toEqual([container]);
    expect(result.skippedContainerIds.size).toBe(0);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        containerId: 'plain-container-id',
        containerName: '(unknown)',
        decision: 'allowed',
        reason: 'not-recreated-alias',
      }),
    ]);
  });

  test('filterRecreatedContainerAliases keeps alias when current container does not expose base name as an array', () => {
    const aliasName = '/7ea6b8a42686_termix';
    const container = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a11',
      Names: [aliasName],
      Created: Math.floor(Date.now() / 1000) - 120,
    } as any;

    const result = filterRecreatedContainerAliases([container], []);

    // Alias detected, stale (120s ago), no sibling/store match → allowed
    expect(result.containersToWatch).toEqual([container]);
    expect(result.skippedContainerIds.size).toBe(0);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        containerName: 'termix',
        baseName: 'termix',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
      }),
    ]);
  });

  test('filterRecreatedContainerAliases handles string Created values and future timestamps', () => {
    const numericCreatedContainer = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a13',
      Names: ['/7ea6b8a42686_termix'],
      Created: '1700000000',
    } as any;

    const millisecondCreatedContainer = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a15',
      Names: ['/7ea6b8a42686_termix'],
      Created: '1700000000000',
    } as any;

    const futureCreatedContainer = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a14',
      Names: ['/7ea6b8a42686_termix'],
      Created: new Date(Date.now() + 120_000).toISOString(),
    } as any;

    const invalidCreatedContainer = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a16',
      Names: ['/7ea6b8a42686_termix'],
      Created: 'not-a-date',
    } as any;

    const numericResult = filterRecreatedContainerAliases([numericCreatedContainer], []);
    const millisecondResult = filterRecreatedContainerAliases([millisecondCreatedContainer], []);
    const futureResult = filterRecreatedContainerAliases([futureCreatedContainer], []);
    const invalidResult = filterRecreatedContainerAliases([invalidCreatedContainer], []);

    // All are aliases (Id matches prefix), stale with no sibling/store match → allowed
    expect(numericResult.containersToWatch).toEqual([numericCreatedContainer]);
    expect(numericResult.skippedContainerIds.size).toBe(0);
    expect(numericResult.decisions).toEqual([
      expect.objectContaining({
        containerId: numericCreatedContainer.Id,
        containerName: 'termix',
        baseName: 'termix',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
      }),
    ]);

    expect(millisecondResult.containersToWatch).toEqual([millisecondCreatedContainer]);
    expect(millisecondResult.skippedContainerIds.size).toBe(0);
    expect(millisecondResult.decisions).toEqual([
      expect.objectContaining({
        containerId: millisecondCreatedContainer.Id,
        containerName: 'termix',
        baseName: 'termix',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
      }),
    ]);

    expect(futureResult.containersToWatch).toEqual([futureCreatedContainer]);
    expect(futureResult.skippedContainerIds.size).toBe(0);
    expect(futureResult.decisions).toEqual([
      expect.objectContaining({
        containerId: futureCreatedContainer.Id,
        containerName: 'termix',
        baseName: 'termix',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
      }),
    ]);

    expect(invalidResult.containersToWatch).toEqual([invalidCreatedContainer]);
    expect(invalidResult.skippedContainerIds.size).toBe(0);
    expect(invalidResult.decisions).toEqual([
      expect.objectContaining({
        containerId: invalidCreatedContainer.Id,
        containerName: 'termix',
        baseName: 'termix',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
      }),
    ]);
  });

  test.each([
    {
      ddKey: 'dd.trigger.include',
      aliasKey: 'dd.action.include',
      aliasValue: 'action-include',
      legacyValue: 'legacy-include',
      fallbackKey: 'wud.trigger.include',
    },
    {
      ddKey: 'dd.trigger.exclude',
      aliasKey: 'dd.notification.exclude',
      aliasValue: 'notification-exclude',
      fallbackKey: 'wud.trigger.exclude',
    },
  ])('getLabel prefers $aliasKey over $ddKey', ({
    aliasKey,
    aliasValue,
    ddKey,
    fallbackKey,
    legacyValue,
  }) => {
    const labels: Record<string, string> = {
      [aliasKey]: aliasValue,
    };
    if (legacyValue) {
      labels[ddKey] = legacyValue;
    }

    expect(getLabel(labels, ddKey, fallbackKey)).toBe(aliasValue);
  });

  test('getMatchingImgsetConfiguration returns undefined for missing configs and picks the best match', () => {
    expect(
      getMatchingImgsetConfiguration({ path: 'library/nginx', domain: 'docker.io' }, undefined),
    ).toBeUndefined();
    expect(
      getMatchingImgsetConfiguration(
        { path: 'library/nginx', domain: 'docker.io' },
        {
          zebra: { image: 'nginx', display: { name: 'Z' } },
          alpha: { image: 'docker.io/library/nginx', display: { name: 'A' } },
          ignored: { image: 'library/redis' },
        },
      ),
    ).toEqual(
      expect.objectContaining({
        name: 'alpha',
        displayName: 'A',
      }),
    );
  });

  test('filterRecreatedContainerAliases skips aliases when the base name already exists in store', () => {
    const aliasName = '/7ea6b8a42686_termix';
    const container = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a17',
      Names: [aliasName],
      Created: '1700000000000',
    } as any;

    const result = filterRecreatedContainerAliases(
      [container],
      [{ id: 'store-termix', name: 'termix' } as any],
    );

    expect(result.containersToWatch).toEqual([]);
    expect(result.skippedContainerIds.size).toBe(1);
    expect(result.skippedContainerIds.has(container.Id)).toBe(true);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        containerId: container.Id,
        containerName: 'termix',
        baseName: 'termix',
        decision: 'skipped',
        reason: 'base-name-present-in-store',
      }),
    ]);
  });

  test('filterRecreatedContainerAliases skips aliases that are still fresh', () => {
    const aliasName = '/7ea6b8a42686_termix';
    const container = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a18',
      Names: [aliasName],
      Created: Date.now() - 5_000,
    } as any;

    const result = filterRecreatedContainerAliases([container], []);

    expect(result.containersToWatch).toEqual([]);
    expect(result.skippedContainerIds.size).toBe(1);
    expect(result.skippedContainerIds.has(container.Id)).toBe(true);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        containerId: container.Id,
        containerName: 'termix',
        baseName: 'termix',
        decision: 'skipped',
        reason: 'fresh-recreated-alias',
      }),
    ]);
  });
});
