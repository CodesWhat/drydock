import type { Container } from './container.js';
import {
  GROUP_POLICY_ACTION_HINT,
  type GroupPolicy,
  GroupPolicyValidationError,
  getGroupExcludeEntries,
  groupTriggerExcludedMessage,
  groupUpdateModeRejectionMessage,
  isValidGroupPolicyName,
  mostRestrictiveUpdateMode,
  normalizeGroupPolicyActions,
  normalizeGroupPolicyBody,
  normalizeGroupPolicyUpdatePolicy,
  resolveUpdateModeCeiling,
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
    expect(normalizeGroupPolicyActions({ updateMode: 'manual', exclude: [] })).toEqual({
      updateMode: 'manual',
    });
    expect(normalizeGroupPolicyActions({ exclude: ['docker.local:ALL', 'x:major-only'] })).toEqual({
      exclude: ['docker.local:ALL', 'x:major-only'],
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
    ['an empty exclusion', { exclude: [''] }],
    ['a whitespace-only exclusion', { exclude: ['docker.local', '  '] }],
    ['an exclusion holding a comma', { exclude: ['docker.local,dockercompose'] }],
    ['an exclusion with an unsupported threshold', { exclude: ['docker.local:huge'] }],
    ['an exclusion with two thresholds', { exclude: ['docker.local:major:minor'] }],
    ['an exclusion with an empty threshold', { exclude: ['docker.local:'] }],
    ['an exclusion with no trigger name', { exclude: [':major'] }],
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

function member(groupPolicy?: Container['groupPolicy']): Pick<Container, 'groupPolicy'> {
  return { groupPolicy };
}

function snapshot(actions: GroupPolicy['actions']): NonNullable<Container['groupPolicy']> {
  return { id: 'policy-1', group: 'payments', revision: 2, updatePolicy: {}, actions };
}

describe('mostRestrictiveUpdateMode', () => {
  const MODES = ['notify', 'manual', 'auto'] as const;
  const RANK = { notify: 0, manual: 1, auto: 2 } as const;

  test.each(MODES.flatMap((a) => MODES.map((b) => [a, b] as const)))(
    '%s with %s is the lower ranked of the two',
    (a, b) => {
      expect(mostRestrictiveUpdateMode(a, b)).toBe(RANK[a] <= RANK[b] ? a : b);
    },
  );

  test('is symmetric and never returns auto unless both are auto', () => {
    for (const a of MODES) {
      for (const b of MODES) {
        expect(mostRestrictiveUpdateMode(a, b)).toBe(mostRestrictiveUpdateMode(b, a));
        expect(mostRestrictiveUpdateMode(a, b) === 'auto').toBe(a === 'auto' && b === 'auto');
      }
    }
  });
});

describe('resolveUpdateModeCeiling', () => {
  test('is the global mode, sourced global, when the container has no group policy', () => {
    expect(resolveUpdateModeCeiling(member(), 'auto')).toEqual({ value: 'auto', source: 'global' });
    expect(resolveUpdateModeCeiling(member(), 'notify')).toEqual({
      value: 'notify',
      source: 'global',
    });
  });

  test('is the global mode when the policy sets no update mode', () => {
    expect(resolveUpdateModeCeiling(member(snapshot({ exclude: ['docker'] })), 'auto')).toEqual({
      value: 'auto',
      source: 'global',
    });
  });

  test('names the group only when it is strictly more restrictive than global', () => {
    expect(resolveUpdateModeCeiling(member(snapshot({ updateMode: 'manual' })), 'auto')).toEqual({
      value: 'manual',
      source: 'group',
      group: 'payments',
      policyId: 'policy-1',
    });
    expect(resolveUpdateModeCeiling(member(snapshot({ updateMode: 'notify' })), 'manual')).toEqual({
      value: 'notify',
      source: 'group',
      group: 'payments',
      policyId: 'policy-1',
    });
  });

  test('keeps global as the binding value when it is as strict or stricter', () => {
    expect(resolveUpdateModeCeiling(member(snapshot({ updateMode: 'manual' })), 'notify')).toEqual({
      value: 'notify',
      source: 'global',
    });
    expect(resolveUpdateModeCeiling(member(snapshot({ updateMode: 'manual' })), 'manual')).toEqual({
      value: 'manual',
      source: 'global',
    });
  });
});

describe('groupUpdateModeRejectionMessage', () => {
  test('names the group and what it allows', () => {
    expect(groupUpdateModeRejectionMessage('payments', 'manual')).toBe(
      "Group policy 'payments' allows manual updates only",
    );
    expect(groupUpdateModeRejectionMessage('payments', 'notify')).toBe(
      "Group policy 'payments' allows notifications only",
    );
  });
});

describe('getGroupExcludeEntries', () => {
  test('is empty without a policy or without exclusions', () => {
    expect(getGroupExcludeEntries(member())).toEqual([]);
    expect(getGroupExcludeEntries(member(snapshot({ updateMode: 'manual' })))).toEqual([]);
  });

  test('returns the snapshot entries', () => {
    expect(
      getGroupExcludeEntries(member(snapshot({ exclude: ['docker.local:major', 'command'] }))),
    ).toEqual(['docker.local:major', 'command']);
  });
});

describe('groupTriggerExcludedMessage', () => {
  test('names the group and the matching entries', () => {
    expect(groupTriggerExcludedMessage('payments', ['docker.local:major', 'local'])).toBe(
      "Trigger excluded by group policy 'payments' (docker.local:major,local).",
    );
  });

  test('has an action hint pointing at the policy and at dd.group', () => {
    expect(GROUP_POLICY_ACTION_HINT).toBe(
      'Change the group policy, or move the container with dd.group.',
    );
  });
});
