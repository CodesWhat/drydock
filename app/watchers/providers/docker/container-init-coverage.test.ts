import { describe, expect, test, vi } from 'vitest';
import log from '../../../log/index.js';
import { recordLegacyInput } from '../../../prometheus/compatibility.js';
import {
  applyDerivedLabelFieldsToContainer,
  filterRecreatedContainerAliases,
  getMatchingImgsetConfiguration,
  mergeConfigWithImgset,
  resolveTriggerLabelOverrides,
  warnTriggerCategoryScopeChangeIfNeeded,
} from './container-init.js';

vi.mock('../../../log/index.js', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
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

const mockGetState = vi.hoisted(() => vi.fn(() => ({ trigger: {} })));

vi.mock('../../../registry/index.js', () => ({
  getState: mockGetState,
}));

// Mocks are not auto-cleared (no clearMocks in vitest.config.ts), and the call-count
// assertions below are only meaningful against a per-test baseline.
beforeEach(() => {
  vi.clearAllMocks();
  mockGetState.mockReturnValue({ trigger: {} });
});

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

  test('filterRecreatedContainerAliases falls back to getContainerName when Names is array-like but not an array', () => {
    const aliasName = '/7ea6b8a42686_termix';
    const container = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a1f',
      // Non-array shape exercises fallback name-map path and current-name guard.
      Names: { 0: aliasName, length: 1 },
      Created: Math.floor((Date.now() - 120_000) / 1000),
    } as any;

    const result = filterRecreatedContainerAliases([container], []);

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

  describe('resolveTriggerLabelOverrides', () => {
    test('resolves both categories independently (#494)', () => {
      expect(
        resolveTriggerLabelOverrides({
          'dd.action.include': 'docker',
          'dd.notification.include': 'slack',
          'dd.action.exclude': 'compose',
          'dd.notification.exclude': 'ntfy',
        }),
      ).toEqual({
        actionTriggerInclude: 'docker',
        actionTriggerExclude: 'compose',
        notificationTriggerInclude: 'slack',
        notificationTriggerExclude: 'ntfy',
        triggerInclude: 'docker',
        triggerExclude: 'compose',
      });
    });

    test('a lone scoped label leaves the other category unset (strict scoping)', () => {
      const resolved = resolveTriggerLabelOverrides({ 'dd.action.include': 'docker' });

      expect(resolved.actionTriggerInclude).toBe('docker');
      expect(resolved.notificationTriggerInclude).toBeUndefined();
      expect(resolved.triggerInclude).toBe('docker');
    });

    test('the deprecated label fills only the categories without a scoped label, warns once, and records the legacy input once per resolution', () => {
      const warn = vi.fn();
      const warnedLegacyTriggerLabels = new Set<string>();
      const labels = { 'dd.action.include': 'docker', 'dd.trigger.include': 'both' };

      const first = resolveTriggerLabelOverrides(labels, {}, { warn, warnedLegacyTriggerLabels });
      expect(first.actionTriggerInclude).toBe('docker');
      expect(first.notificationTriggerInclude).toBe('both');
      expect(first.triggerInclude).toBe('docker');

      // One legacy label, one direction, one metric increment — not one per category.
      expect(recordLegacyInput).toHaveBeenCalledTimes(1);
      expect(recordLegacyInput).toHaveBeenCalledWith('label', 'dd.trigger.include');

      resolveTriggerLabelOverrides(labels, {}, { warn, warnedLegacyTriggerLabels });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('dd.trigger.include');
    });

    test('records a legacy input per direction when both deprecated labels are present', () => {
      resolveTriggerLabelOverrides(
        { 'dd.trigger.include': 'both', 'dd.trigger.exclude': 'both' },
        {},
        { warn: vi.fn(), warnedLegacyTriggerLabels: new Set() },
      );

      expect(recordLegacyInput).toHaveBeenCalledTimes(2);
      expect(recordLegacyInput).toHaveBeenCalledWith('label', 'dd.trigger.include');
      expect(recordLegacyInput).toHaveBeenCalledWith('label', 'dd.trigger.exclude');
    });

    test('reuses fully-resolved overrides instead of re-reading the labels a second time', () => {
      const warn = vi.fn();
      const labels = { 'dd.trigger.include': 'both', 'dd.trigger.exclude': 'both' };

      // Docker.ts resolves these labels once to build the override bag; resolveLabelsFromContainer
      // then resolves the same labels again. The second pass must not re-fire the side effects.
      const overrides = resolveTriggerLabelOverrides(
        labels,
        {},
        { warn, warnedLegacyTriggerLabels: new Set() },
      );
      expect(recordLegacyInput).toHaveBeenCalledTimes(2);

      const second = resolveTriggerLabelOverrides(labels, overrides, {
        warn,
        warnedLegacyTriggerLabels: new Set(),
      });

      expect(second).toEqual(overrides);
      expect(recordLegacyInput).toHaveBeenCalledTimes(2);
    });

    test('still re-reads a direction whose overrides are only partially resolved', () => {
      const resolved = resolveTriggerLabelOverrides(
        { 'dd.action.include': 'docker', 'dd.notification.include': 'slack' },
        { actionTriggerInclude: 'docker', triggerInclude: 'docker' },
      );

      expect(resolved.notificationTriggerInclude).toBe('slack');
    });

    test('warns naming the exclude aliases for a deprecated dd.trigger.exclude label', () => {
      const warn = vi.fn();

      const resolved = resolveTriggerLabelOverrides(
        { 'dd.trigger.exclude': 'both' },
        {},
        { warn, warnedLegacyTriggerLabels: new Set() },
      );

      expect(resolved.actionTriggerExclude).toBe('both');
      expect(resolved.notificationTriggerExclude).toBe('both');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('dd.action.exclude');
      expect(warn.mock.calls[0][0]).toContain('dd.notification.exclude');
    });

    test('logs deprecated dd.trigger labels at error level by default', () => {
      resolveTriggerLabelOverrides(
        { 'dd.trigger.include': 'both' },
        {},
        { warnedLegacyTriggerLabels: new Set() },
      );

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('dd.trigger.include'));
      expect(log.warn).not.toHaveBeenCalled();
    });

    test('falls back to the wud.* label for both categories when no dd.* trigger label is present', () => {
      const resolved = resolveTriggerLabelOverrides(
        { 'wud.trigger.exclude': 'legacy' },
        {},
        { warn: vi.fn() },
      );

      expect(resolved.actionTriggerExclude).toBe('legacy');
      expect(resolved.notificationTriggerExclude).toBe('legacy');
      expect(resolved.triggerExclude).toBe('legacy');
    });

    test('explicit overrides take priority over the labels', () => {
      const resolved = resolveTriggerLabelOverrides(
        { 'dd.action.include': 'docker', 'dd.notification.include': 'slack' },
        { actionTriggerInclude: 'override', notificationTriggerExclude: 'override-exclude' },
      );

      expect(resolved.actionTriggerInclude).toBe('override');
      expect(resolved.notificationTriggerInclude).toBe('slack');
      expect(resolved.notificationTriggerExclude).toBe('override-exclude');
    });

    test('yields all-undefined fields when there are no trigger labels', () => {
      expect(resolveTriggerLabelOverrides({ 'dd.watch': 'true' })).toEqual({
        actionTriggerInclude: undefined,
        actionTriggerExclude: undefined,
        notificationTriggerInclude: undefined,
        notificationTriggerExclude: undefined,
        triggerInclude: undefined,
        triggerExclude: undefined,
      });
    });
  });

  describe('warnTriggerCategoryScopeChangeIfNeeded', () => {
    test('warns once when a lone action label no longer gates a configured notification trigger', () => {
      const warn = vi.fn();
      const warnedContainerNames = new Set<string>();
      const resolved = { actionTriggerInclude: 'docker' };
      const options = {
        warn,
        warnedContainerNames,
        hasConfiguredTriggerOfCategory: () => true,
      };

      warnTriggerCategoryScopeChangeIfNeeded('nginx', resolved, options);
      warnTriggerCategoryScopeChangeIfNeeded('nginx', resolved, options);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('dd.action.include');
      expect(warn.mock.calls[0][0]).toContain('dd.notification.include');
      expect(warn.mock.calls[0][0]).toContain('no longer filters notification triggers');
    });

    test('warns for a lone notification exclude when an action trigger is configured', () => {
      const warn = vi.fn();

      warnTriggerCategoryScopeChangeIfNeeded(
        'nginx',
        { notificationTriggerExclude: 'ntfy' },
        { warn, warnedContainerNames: new Set(), hasConfiguredTriggerOfCategory: () => true },
      );

      expect(warn.mock.calls[0][0]).toContain('dd.notification.exclude');
      expect(warn.mock.calls[0][0]).toContain('no longer filters action triggers');
    });

    test('stays quiet when the other category has no configured trigger', () => {
      const warn = vi.fn();

      warnTriggerCategoryScopeChangeIfNeeded(
        'nginx',
        { actionTriggerInclude: 'docker' },
        { warn, warnedContainerNames: new Set(), hasConfiguredTriggerOfCategory: () => false },
      );

      expect(warn).not.toHaveBeenCalled();
    });

    test('stays quiet when both categories are scoped, and when neither is', () => {
      const warn = vi.fn();
      const options = {
        warn,
        warnedContainerNames: new Set<string>(),
        hasConfiguredTriggerOfCategory: () => true,
      };

      warnTriggerCategoryScopeChangeIfNeeded(
        'nginx',
        { actionTriggerInclude: 'docker', notificationTriggerInclude: 'slack' },
        options,
      );
      warnTriggerCategoryScopeChangeIfNeeded('redis', {}, options);

      expect(warn).not.toHaveBeenCalled();
    });

    test('ignores a container with no name', () => {
      const warn = vi.fn();

      warnTriggerCategoryScopeChangeIfNeeded(
        '',
        { actionTriggerInclude: 'docker' },
        { warn, warnedContainerNames: new Set(), hasConfiguredTriggerOfCategory: () => true },
      );

      expect(warn).not.toHaveBeenCalled();
    });

    test('reads the configured triggers from the registry and logs via the default logger', () => {
      mockGetState.mockReturnValue({ trigger: { 'slack.notify': { type: 'slack' } } });

      warnTriggerCategoryScopeChangeIfNeeded('registry-backed', { actionTriggerInclude: 'docker' });

      expect(mockGetState).toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('no longer filters notification triggers'),
      );
    });

    test('stays quiet when the registry has no trigger of the other category', () => {
      vi.mocked(log.warn).mockClear();
      mockGetState.mockReturnValue({ trigger: { 'docker.local': { type: 'docker' } } });

      warnTriggerCategoryScopeChangeIfNeeded('registry-backed-quiet', {
        actionTriggerInclude: 'docker',
      });

      expect(log.warn).not.toHaveBeenCalled();
    });
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

  test('filterRecreatedContainerAliases handles non-array Names via fallback getContainerName (lines 459, 494)', () => {
    // Names is array-like (has indexed access and length) but NOT a real Array.
    // This exercises:
    //   - buildDockerContainerNameToIds line 459: normalizedContainerNames.push(fallbackName)
    //   - hasCurrentContainerWithName line 494: !Array.isArray(Names) → return false
    const arrayLikeNames = { 0: '/7ea6b8a42686_termix', length: 1 } as any;
    const container = {
      Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a19',
      Names: arrayLikeNames,
      Created: '1700000000',
    } as any;

    const result = filterRecreatedContainerAliases([container], []);

    // Alias detected, stale, no sibling/store match → allowed
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

  describe('applyDerivedLabelFieldsToContainer', () => {
    function makeContainer(overrides: Record<string, any> = {}) {
      return {
        id: 'ctr1',
        name: 'my-app',
        displayName: 'my-app',
        status: 'running',
        watcher: 'local',
        image: { name: 'library/nginx', tag: { value: '1.0', semver: true } },
        labels: {},
        updateAvailable: false,
        updateKind: { kind: 'unknown' },
        ...overrides,
      } as any;
    }

    test('derives tagFamily from dd.tag.family label', () => {
      const container = makeContainer();
      applyDerivedLabelFieldsToContainer(container, { 'dd.tag.family': 'loose' });
      expect(container.tagFamily).toBe('loose');
    });

    test('derives tagPinInfo from dd.tag.pin.info label', () => {
      const container = makeContainer();
      applyDerivedLabelFieldsToContainer(container, { 'dd.tag.pin.info': 'false' });
      expect(container.tagPinInfo).toBe(false);
    });

    test('restores supplied imgset/watcher tag-policy fallbacks when labels are removed', () => {
      const container = makeContainer({ tagFamily: 'loose', tagPinInfo: false });
      applyDerivedLabelFieldsToContainer(container, {}, { tagFamily: 'strict', tagPinInfo: true });
      expect(container.tagFamily).toBe('strict');
      expect(container.tagPinInfo).toBe(true);
    });

    test('derives the four category-scoped trigger fields from the labels', () => {
      const container = makeContainer();

      applyDerivedLabelFieldsToContainer(container, {
        'dd.action.include': 'docker',
        'dd.notification.exclude': 'ntfy',
      });

      expect(container.actionTriggerInclude).toBe('docker');
      expect(container.notificationTriggerExclude).toBe('ntfy');
      expect(container.notificationTriggerInclude).toBeUndefined();
      expect(container.triggerInclude).toBe('docker');
    });

    test('never emits the category-scope warning on the event path (labels here are imgset-blind)', () => {
      mockGetState.mockReturnValue({ trigger: { 'slack.notify': { type: 'slack' } } });
      const container = makeContainer({ name: 'imgset-backed' });

      // A lone dd.action.include looks asymmetric from labels alone, but a matching imgset
      // may well supply the notification filter. Warning here would be a false positive that
      // latches for the life of the process.
      applyDerivedLabelFieldsToContainer(container, { 'dd.action.include': 'docker' });

      expect(log.warn).not.toHaveBeenCalled();
    });

    test('derives includeTags from dd.tag.include label', () => {
      const container = makeContainer();
      applyDerivedLabelFieldsToContainer(container, { 'dd.tag.include': '^1\\..*' });
      expect(container.includeTags).toBe('^1\\..*');
    });

    test('derives excludeTags from dd.tag.exclude label', () => {
      const container = makeContainer();
      applyDerivedLabelFieldsToContainer(container, { 'dd.tag.exclude': '^alpha' });
      expect(container.excludeTags).toBe('^alpha');
    });

    test('derives transformTags from dd.tag.transform label', () => {
      const container = makeContainer();
      applyDerivedLabelFieldsToContainer(container, { 'dd.tag.transform': 's/v//' });
      expect(container.transformTags).toBe('s/v//');
    });

    test('derives linkTemplate from dd.link.template label', () => {
      const container = makeContainer();
      applyDerivedLabelFieldsToContainer(container, {
        'dd.link.template': 'https://example.com/${major}',
      });
      expect(container.linkTemplate).toBe('https://example.com/${major}');
    });

    test('derives triggerInclude from dd.action.include label', () => {
      const container = makeContainer();
      applyDerivedLabelFieldsToContainer(container, { 'dd.action.include': 'my-action' });
      expect(container.triggerInclude).toBe('my-action');
    });

    test('derives triggerExclude from dd.notification.exclude label', () => {
      const container = makeContainer();
      applyDerivedLabelFieldsToContainer(container, { 'dd.notification.exclude': 'slack' });
      expect(container.triggerExclude).toBe('slack');
    });

    test('falls back to wud.* label when dd.* label is absent', () => {
      const container = makeContainer();
      applyDerivedLabelFieldsToContainer(container, { 'wud.tag.include': '^v' });
      expect(container.includeTags).toBe('^v');
    });

    test('clears derived fields when labels are removed', () => {
      const container = makeContainer({
        tagFamily: 'loose',
        includeTags: '^1\\..*',
        excludeTags: '^alpha',
      });
      applyDerivedLabelFieldsToContainer(container, {});
      expect(container.tagFamily).toBeUndefined();
      expect(container.includeTags).toBeUndefined();
      expect(container.excludeTags).toBeUndefined();
    });

    test('handles undefined labels gracefully by treating as empty object', () => {
      const container = makeContainer({ tagFamily: 'loose' });
      // Pass empty record (undefined labels are normalized upstream before this point)
      applyDerivedLabelFieldsToContainer(container, {});
      expect(container.tagFamily).toBeUndefined();
    });

    test('does not modify displayName (managed separately by event handler)', () => {
      const container = makeContainer({ displayName: 'My Custom App' });
      applyDerivedLabelFieldsToContainer(container, { 'dd.display.name': 'New Display Name' });
      // displayName is intentionally NOT updated by applyDerivedLabelFieldsToContainer
      expect(container.displayName).toBe('My Custom App');
    });
  });

  describe('tag policy precedence (#498)', () => {
    test('resolves labels above imgsets above watcher defaults', () => {
      expect(
        mergeConfigWithImgset(
          { tagFamily: 'loose', tagPinInfo: 'true' },
          { name: 'service', tagFamily: 'strict', tagPinInfo: false },
          {},
          { family: 'strict', pin: { info: false } },
        ),
      ).toEqual(
        expect.objectContaining({
          tagFamily: 'loose',
          tagPinInfo: true,
        }),
      );
    });

    test('uses imgset values above watcher defaults when labels are absent', () => {
      expect(
        mergeConfigWithImgset(
          {},
          { name: 'service', tagFamily: 'strict', tagPinInfo: false },
          {},
          { family: 'loose', pin: { info: true } },
        ),
      ).toEqual(
        expect.objectContaining({
          tagFamily: 'strict',
          tagPinInfo: false,
        }),
      );
    });

    test('falls back to watcher values and then built-in defaults', () => {
      expect(
        mergeConfigWithImgset({}, undefined, {}, { family: 'loose', pin: { info: false } }),
      ).toEqual(expect.objectContaining({ tagFamily: 'loose', tagPinInfo: false }));
      expect(mergeConfigWithImgset({}, undefined, {})).toEqual(
        expect.objectContaining({ tagFamily: 'strict', tagPinInfo: true }),
      );
    });
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
