import {
  getNotificationTriggerIdsFromState,
  isNotificationTriggerType,
  normalizeNotificationTriggerIds,
} from './trigger-policy.js';

describe('notification trigger policy', () => {
  test('isNotificationTriggerType should reject update trigger types', () => {
    expect(isNotificationTriggerType('docker')).toBe(false);
    expect(isNotificationTriggerType('dockercompose')).toBe(false);
  });

  test('isNotificationTriggerType should reject empty/undefined types', () => {
    expect(isNotificationTriggerType('')).toBe(false);
    expect(isNotificationTriggerType(undefined)).toBe(false);
    expect(isNotificationTriggerType('   ')).toBe(false);
  });

  test('isNotificationTriggerType should accept notification trigger types', () => {
    expect(isNotificationTriggerType('slack')).toBe(true);
    expect(isNotificationTriggerType('smtp')).toBe(true);
  });

  test('getNotificationTriggerIdsFromState should return only notification trigger ids', () => {
    expect(
      Array.from(
        getNotificationTriggerIdsFromState({
          'slack.ops': { type: 'slack' },
          'docker.update': { type: 'docker' },
          'dockercompose.update': { type: 'dockercompose' },
          'smtp.ops': { type: 'smtp' },
        }),
      ).sort(),
    ).toEqual(['slack.ops', 'smtp.ops']);
  });

  test('getNotificationTriggerIdsFromState should return empty set for undefined state', () => {
    expect(Array.from(getNotificationTriggerIdsFromState(undefined as any))).toEqual([]);
  });

  test('normalizeNotificationTriggerIds should filter, dedupe and sort ids', () => {
    const allowedTriggerIds = new Set(['slack.ops', 'smtp.ops']);
    expect(
      normalizeNotificationTriggerIds(
        ['smtp.ops', 'docker.update', 'slack.ops', 'smtp.ops', ''],
        allowedTriggerIds,
      ),
    ).toEqual(['slack.ops', 'smtp.ops']);
  });

  test('normalizeNotificationTriggerIds should return empty list for non-array payloads', () => {
    const allowedTriggerIds = new Set(['slack.ops']);
    expect(normalizeNotificationTriggerIds(undefined, allowedTriggerIds)).toEqual([]);
    expect(
      normalizeNotificationTriggerIds('slack.ops' as unknown as string[], allowedTriggerIds),
    ).toEqual([]);
  });
});
