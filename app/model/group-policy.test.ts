import {
  type GroupPolicy,
  GroupPolicyValidationError,
  isValidGroupPolicyName,
  normalizeGroupPolicyActions,
  normalizeGroupPolicyBody,
  normalizeGroupPolicyUpdatePolicy,
  toContainerGroupPolicySnapshot,
} from './group-policy.js';

describe('isValidGroupPolicyName', () => {
  test.each([
    ['payments', true],
    [' payments ', true],
    ['Zahlungen/€', true],
    ['', false],
    ['   ', false],
    ['\t\n', false],
    [undefined, false],
    [null, false],
    [42, false],
  ])('%j is %s', (value, expected) => {
    expect(isValidGroupPolicyName(value)).toBe(expected);
  });
});

describe('normalizeGroupPolicyUpdatePolicy', () => {
  test('keeps every declarative field in canonical order', () => {
    const normalized = normalizeGroupPolicyUpdatePolicy({
      skipDigests: ['sha256:b'],
      skipTags: ['2.0.0'],
      maturityMinAgeDays: 14,
      maturityMode: 'mature',
    });

    expect(normalized).toEqual({
      maturityMode: 'mature',
      maturityMinAgeDays: 14,
      skipTags: ['2.0.0'],
      skipDigests: ['sha256:b'],
    });
    expect(Object.keys(normalized)).toEqual([
      'maturityMode',
      'maturityMinAgeDays',
      'skipTags',
      'skipDigests',
    ]);
  });

  test('keeps maturityMode all, which deliberately shadows a watcher mature default', () => {
    expect(normalizeGroupPolicyUpdatePolicy({ maturityMode: 'all' })).toEqual({
      maturityMode: 'all',
    });
  });

  test('trims and de-duplicates skip lists, and drops a list left empty', () => {
    expect(
      normalizeGroupPolicyUpdatePolicy({
        skipTags: [' 1.0.0 ', '1.0.0', '1.1.0'],
        skipDigests: ['  '],
      }),
    ).toEqual({ skipTags: ['1.0.0', '1.1.0'] });
    expect(normalizeGroupPolicyUpdatePolicy({ skipTags: [] })).toEqual({});
  });

  test('treats an absent body as empty', () => {
    expect(normalizeGroupPolicyUpdatePolicy(undefined)).toEqual({});
  });

  test.each([
    ['an unknown field', { snoozeUntil: '2030-01-01T00:00:00.000Z' }],
    ['an unknown maturity mode', { maturityMode: 'Mature' }],
    ['a minimum age out of range', { maturityMinAgeDays: 366 }],
    ['a non-integer minimum age', { maturityMinAgeDays: 1.5 }],
    ['a numeric string minimum age', { maturityMinAgeDays: '7' }],
    ['a non-string skip entry', { skipTags: [1] }],
    ['a non-object body', ['maturityMode']],
    ['a null body', null],
  ])('rejects %s', (_case, body) => {
    expect(() => normalizeGroupPolicyUpdatePolicy(body)).toThrow(GroupPolicyValidationError);
  });
});

describe('normalizeGroupPolicyActions', () => {
  test('keeps a restricting update mode and a trimmed, de-duplicated exclude list', () => {
    expect(
      normalizeGroupPolicyActions({
        updateMode: 'notify',
        exclude: [' docker.local:major ', 'docker.local:major', 'dockercompose'],
      }),
    ).toEqual({ updateMode: 'notify', exclude: ['docker.local:major', 'dockercompose'] });
    expect(normalizeGroupPolicyActions({ updateMode: 'manual', exclude: [' '] })).toEqual({
      updateMode: 'manual',
    });
    expect(normalizeGroupPolicyActions(undefined)).toEqual({});
  });

  test('refuses automatic updates, because group rules can only restrict', () => {
    expect(() => normalizeGroupPolicyActions({ updateMode: 'auto' })).toThrow(/only restrict/);
  });

  test.each([
    ['an unknown field', { include: ['docker.local'] }],
    ['an unknown update mode', { updateMode: 'never' }],
    ['a non-string exclusion', { exclude: [true] }],
    ['a non-object body', 'manual'],
    ['a null body', null],
  ])('rejects %s', (_case, body) => {
    expect(() => normalizeGroupPolicyActions(body)).toThrow(GroupPolicyValidationError);
  });
});

describe('normalizeGroupPolicyBody', () => {
  test('normalizes both parts', () => {
    expect(
      normalizeGroupPolicyBody({
        updatePolicy: { skipTags: [' 1.0.0 '] },
        actions: { updateMode: 'manual' },
      }),
    ).toEqual({ updatePolicy: { skipTags: ['1.0.0'] }, actions: { updateMode: 'manual' } });
  });

  test('accepts a body that only sets actions or only sets update policy', () => {
    expect(normalizeGroupPolicyBody({ actions: { exclude: ['docker.local'] } })).toEqual({
      updatePolicy: {},
      actions: { exclude: ['docker.local'] },
    });
    expect(normalizeGroupPolicyBody({ updatePolicy: { maturityMode: 'all' } })).toEqual({
      updatePolicy: { maturityMode: 'all' },
      actions: {},
    });
  });

  test('rejects a policy that sets nothing once normalized', () => {
    expect(() => normalizeGroupPolicyBody({})).toThrow(GroupPolicyValidationError);
    expect(() => normalizeGroupPolicyBody({ updatePolicy: { skipTags: [' '] } })).toThrow(
      /at least one/,
    );
  });
});

describe('toContainerGroupPolicySnapshot', () => {
  test('keeps only the identity and the bodies, copied', () => {
    const policy: GroupPolicy = {
      id: 'policy-1',
      group: 'payments',
      revision: 3,
      updatePolicy: { skipTags: ['1.0.0'] },
      actions: { exclude: ['docker.local'] },
      createdAt: '2026-10-01T00:00:00.000Z',
      createdBy: 'user:admin',
      updatedAt: '2026-10-02T00:00:00.000Z',
      updatedBy: 'api-key:abc',
    };

    const snapshot = toContainerGroupPolicySnapshot(policy);
    policy.updatePolicy.skipTags?.push('mutated');
    policy.actions.exclude?.push('mutated');

    expect(snapshot).toEqual({
      id: 'policy-1',
      group: 'payments',
      revision: 3,
      updatePolicy: { skipTags: ['1.0.0'] },
      actions: { exclude: ['docker.local'] },
    });
  });
});
