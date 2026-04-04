import { describe, expect, test, vi } from 'vitest';
import { recordLegacyInput } from '../prometheus/compatibility.js';
import { getPreferredLabelValue } from './legacy-label.js';

vi.mock('../prometheus/compatibility.js', () => ({
  recordLegacyInput: vi.fn(),
}));

describe('getPreferredLabelValue', () => {
  test('returns dd label value when both dd and wud labels are present', () => {
    expect(
      getPreferredLabelValue(
        { 'dd.watch': 'dd-value', 'wud.watch': 'legacy-value' },
        'dd.watch',
        'wud.watch',
      ),
    ).toBe('dd-value');
  });

  test('falls back to wud label and logs deprecation once per key', () => {
    const warnedFallbacks = new Set<string>();
    const warn = vi.fn();

    expect(
      getPreferredLabelValue({ 'wud.watch': 'legacy-1' }, 'dd.watch', 'wud.watch', {
        warnedFallbacks,
        warn,
      }),
    ).toBe('legacy-1');
    expect(
      getPreferredLabelValue({ 'wud.watch': 'legacy-2' }, 'dd.watch', 'wud.watch', {
        warnedFallbacks,
        warn,
      }),
    ).toBe('legacy-2');

    expect(recordLegacyInput).toHaveBeenCalledTimes(2);
    expect(recordLegacyInput).toHaveBeenCalledWith('label', 'wud.watch');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Legacy Docker label "wud.watch" is deprecated. Please migrate to "dd.watch" before removal in v1.6.0.',
    );
  });

  test('returns undefined when no fallback key is provided or no key exists', () => {
    expect(getPreferredLabelValue({}, 'dd.watch')).toBeUndefined();
    expect(getPreferredLabelValue({ 'dd.watch': 'yes' }, 'dd.watch', 'wud.watch')).toBe('yes');
    expect(getPreferredLabelValue({}, 'dd.watch', 'wud.watch')).toBeUndefined();
  });

  test('falls back without a warn handler when no deprecation callback is provided', () => {
    vi.clearAllMocks();

    expect(getPreferredLabelValue({ 'wud.watch': 'legacy-1' }, 'dd.watch', 'wud.watch')).toBe(
      'legacy-1',
    );

    expect(recordLegacyInput).toHaveBeenCalledTimes(1);
    expect(recordLegacyInput).toHaveBeenCalledWith('label', 'wud.watch');
  });

  test('uses shared fallback warning registry when warnedFallbacks is not provided', () => {
    vi.clearAllMocks();
    const warn = vi.fn();

    expect(
      getPreferredLabelValue({ 'wud.unique-key': 'legacy-1' }, 'dd.watch', 'wud.unique-key', {
        warn,
      }),
    ).toBe('legacy-1');
    expect(
      getPreferredLabelValue({ 'wud.unique-key': 'legacy-2' }, 'dd.watch', 'wud.unique-key', {
        warn,
      }),
    ).toBe('legacy-2');

    expect(recordLegacyInput).toHaveBeenCalledWith('label', 'wud.unique-key');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('docker label constants', () => {
  test('exports the expected preferred dd.* labels', async () => {
    vi.resetModules();
    const labels = await import('../watchers/providers/docker/label.js');

    expect({
      ddWatch: labels.ddWatch,
      ddTagInclude: labels.ddTagInclude,
      ddTagExclude: labels.ddTagExclude,
      ddTagTransform: labels.ddTagTransform,
      ddTagFamily: labels.ddTagFamily,
      ddInspectTagPath: labels.ddInspectTagPath,
      ddRegistryLookupImage: labels.ddRegistryLookupImage,
      ddRegistryLookupUrl: labels.ddRegistryLookupUrl,
      ddWatchDigest: labels.ddWatchDigest,
      ddLinkTemplate: labels.ddLinkTemplate,
      ddDisplayName: labels.ddDisplayName,
      ddDisplayIcon: labels.ddDisplayIcon,
      ddActionInclude: labels.ddActionInclude,
      ddNotificationInclude: labels.ddNotificationInclude,
      ddTriggerInclude: labels.ddTriggerInclude,
      ddActionExclude: labels.ddActionExclude,
      ddNotificationExclude: labels.ddNotificationExclude,
      ddTriggerExclude: labels.ddTriggerExclude,
      ddSourceRepo: labels.ddSourceRepo,
      ddGroup: labels.ddGroup,
      ddHookPre: labels.ddHookPre,
      ddHookPost: labels.ddHookPost,
      ddHookPreAbort: labels.ddHookPreAbort,
      ddHookTimeout: labels.ddHookTimeout,
      ddWebhookEnabled: labels.ddWebhookEnabled,
      ddRollbackAuto: labels.ddRollbackAuto,
      ddRollbackWindow: labels.ddRollbackWindow,
      ddRollbackInterval: labels.ddRollbackInterval,
    }).toEqual({
      ddWatch: 'dd.watch',
      ddTagInclude: 'dd.tag.include',
      ddTagExclude: 'dd.tag.exclude',
      ddTagTransform: 'dd.tag.transform',
      ddTagFamily: 'dd.tag.family',
      ddInspectTagPath: 'dd.inspect.tag.path',
      ddRegistryLookupImage: 'dd.registry.lookup.image',
      ddRegistryLookupUrl: 'dd.registry.lookup.url',
      ddWatchDigest: 'dd.watch.digest',
      ddLinkTemplate: 'dd.link.template',
      ddDisplayName: 'dd.display.name',
      ddDisplayIcon: 'dd.display.icon',
      ddActionInclude: 'dd.action.include',
      ddNotificationInclude: 'dd.notification.include',
      ddTriggerInclude: 'dd.trigger.include',
      ddActionExclude: 'dd.action.exclude',
      ddNotificationExclude: 'dd.notification.exclude',
      ddTriggerExclude: 'dd.trigger.exclude',
      ddSourceRepo: 'dd.source.repo',
      ddGroup: 'dd.group',
      ddHookPre: 'dd.hook.pre',
      ddHookPost: 'dd.hook.post',
      ddHookPreAbort: 'dd.hook.pre.abort',
      ddHookTimeout: 'dd.hook.timeout',
      ddWebhookEnabled: 'dd.webhook.enabled',
      ddRollbackAuto: 'dd.rollback.auto',
      ddRollbackWindow: 'dd.rollback.window',
      ddRollbackInterval: 'dd.rollback.interval',
    });
  });

  test('exports the expected legacy wud.* fallback labels', async () => {
    vi.resetModules();
    const labels = await import('../watchers/providers/docker/label.js');

    expect({
      wudWatch: labels.wudWatch,
      wudTagInclude: labels.wudTagInclude,
      wudTagExclude: labels.wudTagExclude,
      wudTagTransform: labels.wudTagTransform,
      wudInspectTagPath: labels.wudInspectTagPath,
      wudRegistryLookupImage: labels.wudRegistryLookupImage,
      wudRegistryLookupUrl: labels.wudRegistryLookupUrl,
      wudWatchDigest: labels.wudWatchDigest,
      wudLinkTemplate: labels.wudLinkTemplate,
      wudDisplayName: labels.wudDisplayName,
      wudDisplayIcon: labels.wudDisplayIcon,
      wudTriggerInclude: labels.wudTriggerInclude,
      wudTriggerExclude: labels.wudTriggerExclude,
      wudGroup: labels.wudGroup,
      wudHookPre: labels.wudHookPre,
      wudHookPost: labels.wudHookPost,
      wudHookPreAbort: labels.wudHookPreAbort,
      wudHookTimeout: labels.wudHookTimeout,
      wudWebhookEnabled: labels.wudWebhookEnabled,
      wudRollbackAuto: labels.wudRollbackAuto,
      wudRollbackWindow: labels.wudRollbackWindow,
      wudRollbackInterval: labels.wudRollbackInterval,
    }).toEqual({
      wudWatch: 'wud.watch',
      wudTagInclude: 'wud.tag.include',
      wudTagExclude: 'wud.tag.exclude',
      wudTagTransform: 'wud.tag.transform',
      wudInspectTagPath: 'wud.inspect.tag.path',
      wudRegistryLookupImage: 'wud.registry.lookup.image',
      wudRegistryLookupUrl: 'wud.registry.lookup.url',
      wudWatchDigest: 'wud.watch.digest',
      wudLinkTemplate: 'wud.link.template',
      wudDisplayName: 'wud.display.name',
      wudDisplayIcon: 'wud.display.icon',
      wudTriggerInclude: 'wud.trigger.include',
      wudTriggerExclude: 'wud.trigger.exclude',
      wudGroup: 'wud.group',
      wudHookPre: 'wud.hook.pre',
      wudHookPost: 'wud.hook.post',
      wudHookPreAbort: 'wud.hook.pre.abort',
      wudHookTimeout: 'wud.hook.timeout',
      wudWebhookEnabled: 'wud.webhook.enabled',
      wudRollbackAuto: 'wud.rollback.auto',
      wudRollbackWindow: 'wud.rollback.window',
      wudRollbackInterval: 'wud.rollback.interval',
    });
  });
});
