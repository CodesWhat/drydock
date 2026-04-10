import {
  doesNotificationTriggerReferenceMatchId,
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
          'missing.ops': undefined,
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
    const allowedTriggerIds = new Set(['slack.ops', 'smtp.ops', '']);
    expect(
      normalizeNotificationTriggerIds(
        [' smtp.ops ', 'docker.update', 'slack.ops', '', 123 as unknown as string],
        allowedTriggerIds,
      ),
    ).toEqual(['slack.ops', 'smtp.ops']);
  });

  test('normalizeNotificationTriggerIds should resolve shorthand references to canonical ids', () => {
    const allowedTriggerIds = new Set(['edge.pushover.mobile', 'smtp.gmail']);
    expect(
      normalizeNotificationTriggerIds([' pushover.mobile ', 'gmail'], allowedTriggerIds),
    ).toEqual(['edge.pushover.mobile', 'smtp.gmail']);
  });

  test('normalizeNotificationTriggerIds should expand shorthand references when multiple ids match', () => {
    const allowedTriggerIds = new Set([
      'alpha.pushover.mobile',
      'beta.pushover.mobile',
      'smtp.gmail',
    ]);
    expect(normalizeNotificationTriggerIds(['mobile'], allowedTriggerIds)).toEqual([
      'alpha.pushover.mobile',
      'beta.pushover.mobile',
    ]);
  });

  test('normalizeNotificationTriggerIds should return empty list for non-array payloads', () => {
    const allowedTriggerIds = new Set(['slack.ops']);
    expect(normalizeNotificationTriggerIds(undefined, allowedTriggerIds)).toEqual([]);
    expect(
      normalizeNotificationTriggerIds('slack.ops' as unknown as string[], allowedTriggerIds),
    ).toEqual([]);
  });

  test('doesNotificationTriggerReferenceMatchId should match exact ids and reject ids without a terminal name', () => {
    expect(doesNotificationTriggerReferenceMatchId(' Slack.Ops ', 'slack.ops')).toBe(true);
    expect(doesNotificationTriggerReferenceMatchId('ops', '.')).toBe(false);
  });

  test('doesNotificationTriggerReferenceMatchId should reject missing references and single-segment ids that do not match', () => {
    expect(doesNotificationTriggerReferenceMatchId(undefined, 'slack.ops')).toBe(false);
    expect(doesNotificationTriggerReferenceMatchId('ops', 'slack')).toBe(false);
  });
});
