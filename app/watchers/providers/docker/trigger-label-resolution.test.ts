import {
  resolveTriggerLabelFieldsPure,
  resolveTriggerLabelValuesPure,
} from './trigger-label-resolution.js';

describe('resolveTriggerLabelValuesPure', () => {
  describe.each(['include', 'exclude'] as const)('direction=%s', (direction) => {
    const action = `dd.action.${direction}`;
    const notification = `dd.notification.${direction}`;
    const deprecated = `dd.trigger.${direction}`;
    const wud = `wud.trigger.${direction}`;

    test('action label only scopes to action and leaves notification unset', () => {
      expect(resolveTriggerLabelValuesPure({ [action]: 'docker' }, direction)).toEqual({
        action: 'docker',
        notification: undefined,
        mirror: 'docker',
      });
    });

    test('notification label only scopes to notification and leaves action unset', () => {
      expect(resolveTriggerLabelValuesPure({ [notification]: 'slack' }, direction)).toEqual({
        action: undefined,
        notification: 'slack',
        mirror: 'slack',
      });
    });

    test('both labels resolve independently (#494)', () => {
      expect(
        resolveTriggerLabelValuesPure({ [action]: 'docker', [notification]: 'slack' }, direction),
      ).toEqual({ action: 'docker', notification: 'slack', mirror: 'docker' });
    });

    test('deprecated label alone applies to both categories', () => {
      expect(resolveTriggerLabelValuesPure({ [deprecated]: 'both' }, direction)).toEqual({
        action: 'both',
        notification: 'both',
        mirror: 'both',
      });
    });

    test('deprecated label is a per-category fallback under an action label', () => {
      expect(
        resolveTriggerLabelValuesPure({ [action]: 'docker', [deprecated]: 'both' }, direction),
      ).toEqual({ action: 'docker', notification: 'both', mirror: 'docker' });
    });

    test('deprecated label is a per-category fallback under a notification label', () => {
      expect(
        resolveTriggerLabelValuesPure({ [notification]: 'slack', [deprecated]: 'both' }, direction),
      ).toEqual({ action: 'both', notification: 'slack', mirror: 'slack' });
    });

    test('both scoped labels fully shadow the deprecated label', () => {
      expect(
        resolveTriggerLabelValuesPure(
          { [action]: 'docker', [notification]: 'slack', [deprecated]: 'both' },
          direction,
        ),
      ).toEqual({ action: 'docker', notification: 'slack', mirror: 'docker' });
    });

    test('wud legacy label applies to both categories when no dd label is present', () => {
      expect(resolveTriggerLabelValuesPure({ [wud]: 'legacy' }, direction)).toEqual({
        action: 'legacy',
        notification: 'legacy',
        mirror: 'legacy',
      });
    });

    test.each([
      ['action', { [action]: 'docker' }],
      ['notification', { [notification]: 'slack' }],
      ['deprecated', { [deprecated]: 'both' }],
    ])('wud legacy label is ignored when the %s dd label is present', (_name, labels) => {
      const resolved = resolveTriggerLabelValuesPure({ ...labels, [wud]: 'legacy' }, direction);
      expect(resolved.mirror).not.toBe('legacy');
    });

    test('no trigger labels resolves to nothing', () => {
      expect(resolveTriggerLabelValuesPure({}, direction)).toEqual({});
      expect(resolveTriggerLabelValuesPure({ 'dd.watch': 'true' }, direction)).toEqual({});
    });

    test('an empty scoped label value is preserved rather than treated as absent', () => {
      expect(
        resolveTriggerLabelValuesPure({ [action]: '', [deprecated]: 'both' }, direction),
      ).toEqual({ action: '', notification: 'both', mirror: '' });
    });
  });

  test('the two directions resolve independently of one another', () => {
    const labels = {
      'dd.action.include': 'docker',
      'dd.notification.exclude': 'slack',
    };

    expect(resolveTriggerLabelValuesPure(labels, 'include')).toEqual({
      action: 'docker',
      notification: undefined,
      mirror: 'docker',
    });
    expect(resolveTriggerLabelValuesPure(labels, 'exclude')).toEqual({
      action: undefined,
      notification: 'slack',
      mirror: 'slack',
    });
  });
});

describe('resolveTriggerLabelFieldsPure', () => {
  test('maps both directions onto the four scoped fields plus the compat mirror', () => {
    expect(
      resolveTriggerLabelFieldsPure({
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

  test('a lone action include leaves the notification include unset (strict scoping)', () => {
    const fields = resolveTriggerLabelFieldsPure({ 'dd.action.include': 'docker' });

    expect(fields.actionTriggerInclude).toBe('docker');
    expect(fields.notificationTriggerInclude).toBeUndefined();
    expect(fields.triggerInclude).toBe('docker');
  });

  test('the mirror keeps the pre-fix first-match value so old consumers are unchanged', () => {
    const fields = resolveTriggerLabelFieldsPure({
      'dd.action.include': 'docker',
      'dd.notification.include': 'slack',
    });

    expect(fields.triggerInclude).toBe('docker');
  });

  test('no trigger labels yields all-undefined fields', () => {
    expect(resolveTriggerLabelFieldsPure({})).toEqual({
      actionTriggerInclude: undefined,
      actionTriggerExclude: undefined,
      notificationTriggerInclude: undefined,
      notificationTriggerExclude: undefined,
      triggerInclude: undefined,
      triggerExclude: undefined,
    });
  });
});
