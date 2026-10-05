import type { ActionPolicyTrigger } from './action-policy.js';
import type { Container, ContainerGroupPolicySnapshot } from './container.js';
import { resolveEffectiveContainerPolicy } from './effective-policy.js';
import { applyGroupUpdatePolicyLayer } from './update-policy.js';

vi.mock('../log/index.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

function snapshot(
  body: Partial<Pick<ContainerGroupPolicySnapshot, 'updatePolicy' | 'actions'>> = {},
  group = 'payments',
): ContainerGroupPolicySnapshot {
  return { id: 'policy-1', group, revision: 3, updatePolicy: {}, actions: {}, ...body };
}

function container(extra: Partial<Container> = {}, group?: ContainerGroupPolicySnapshot) {
  const base = {
    id: 'c1',
    name: 'web',
    watcher: 'local',
    labels: { 'com.docker.compose.project': 'payments' },
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '1.1.0', semverDiff: 'minor' },
    ...extra,
  } as Container;
  return applyGroupUpdatePolicyLayer(base, group);
}

function trigger(
  id: string,
  extra: Partial<ActionPolicyTrigger> = {},
  auto: unknown = 'all',
): ActionPolicyTrigger {
  return {
    type: id.split('.')[0],
    getId: () => id,
    configuration: { auto },
    ...extra,
  } as ActionPolicyTrigger;
}

const TRIGGERS = { 'docker.local': trigger('docker.local') };

function resolve(
  c: Container,
  globalUpdateMode: 'auto' | 'manual' | 'notify' = 'auto',
  t = TRIGGERS,
) {
  return resolveEffectiveContainerPolicy(c, { globalUpdateMode, triggers: t });
}

describe('group', () => {
  test('is null for an ungrouped container', () => {
    expect(resolve(container({ labels: {} })).group).toBeNull();
  });

  test('names the group, the label that supplied it and the policy it carries', () => {
    expect(resolve(container({}, snapshot())).group).toEqual({
      name: 'payments',
      label: 'com.docker.compose.project',
      policyId: 'policy-1',
      revision: 3,
    });
  });

  test('a grouped container with no policy has no policy identity', () => {
    expect(resolve(container()).group).toEqual({
      name: 'payments',
      label: 'com.docker.compose.project',
      policyId: null,
      revision: null,
    });
  });

  test('an empty dd.group is a group that no policy matches', () => {
    expect(resolve(container({ labels: { 'dd.group': '' } })).group).toEqual({
      name: '',
      label: 'dd.group',
      policyId: null,
      revision: null,
    });
  });
});

describe('update policy fields', () => {
  test('a field no layer sets is the built-in default', () => {
    expect(resolve(container()).updatePolicy).toEqual({
      maturityMode: { value: 'all', source: 'default', layers: {} },
      maturityMinAgeDays: { value: 7, source: 'default', layers: {} },
      skipTags: { value: [], source: 'default', layers: {} },
      skipDigests: { value: [], source: 'default', layers: {} },
      snoozeUntil: { value: null, source: 'default' },
    });
  });

  test('the group layer beats the watcher env layer', () => {
    const c = container(
      { updatePolicyDeclarative: { env: { maturityMode: 'mature' }, label: {} } },
      snapshot({ updatePolicy: { maturityMode: 'all' } }),
    );
    expect(resolve(c).updatePolicy.maturityMode).toEqual({
      value: 'all',
      source: 'group',
      layers: { env: 'mature', group: 'all' },
    });
  });

  test('the label layer beats the group layer and the override beats both', () => {
    const c = container(
      {
        updatePolicyDeclarative: {
          env: {},
          label: { maturityMode: 'all', skipTags: ['2.0.0'] },
        },
        updatePolicyOverrides: { skipTags: [] },
      },
      snapshot({ updatePolicy: { maturityMode: 'mature', skipTags: ['1.9.9'] } }),
    );
    const { updatePolicy } = resolve(c);
    expect(updatePolicy.maturityMode).toEqual({
      value: 'all',
      source: 'label',
      layers: { group: 'mature', label: 'all' },
    });
    expect(updatePolicy.skipTags).toEqual({
      value: [],
      source: 'override',
      layers: { group: ['1.9.9'], label: ['2.0.0'], override: [] },
    });
  });

  test('skip digests, min age and snooze report their own layers', () => {
    const c = container(
      {
        updatePolicyOverrides: { skipDigests: ['sha256:a'], snoozeUntil: '2099-01-01T00:00:00Z' },
      },
      snapshot({ updatePolicy: { maturityMinAgeDays: 14, skipDigests: ['sha256:b'] } }),
    );
    const { updatePolicy } = resolve(c);
    expect(updatePolicy.maturityMinAgeDays).toEqual({
      value: 14,
      source: 'group',
      layers: { group: 14 },
    });
    expect(updatePolicy.skipDigests.source).toBe('override');
    expect(updatePolicy.snoozeUntil).toEqual({
      value: '2099-01-01T00:00:00Z',
      source: 'override',
    });
  });

  test('a legacy record with no declarative layer reads its flat policy as overrides', () => {
    const legacy = {
      id: 'c1',
      labels: { 'dd.group': 'payments' },
      updatePolicy: { maturityMode: 'mature' },
    } as unknown as Container;
    expect(resolve(legacy).updatePolicy.maturityMode).toEqual({
      value: 'mature',
      source: 'override',
      layers: { override: 'mature' },
    });
  });

  test('values are copies, so a caller cannot reach back into the container', () => {
    const c = container({ updatePolicyOverrides: { skipTags: ['x'] } });
    const result = resolve(c);
    result.updatePolicy.skipTags.value.push('y');
    expect(c.updatePolicyOverrides?.skipTags).toEqual(['x']);
  });
});

describe('update mode', () => {
  test.each([
    ['auto', undefined, 'auto', 'global'],
    ['auto', 'manual', 'manual', 'group'],
    ['auto', 'notify', 'notify', 'group'],
    ['manual', 'notify', 'notify', 'group'],
    ['manual', 'manual', 'manual', 'global'],
    ['notify', 'manual', 'notify', 'global'],
    ['notify', 'notify', 'notify', 'global'],
  ] as const)('global %s with group %s binds %s from %s', (global, groupMode, value, source) => {
    const c = container({}, snapshot(groupMode ? { actions: { updateMode: groupMode } } : {}));
    const { updateMode } = resolve(c, global).actions;
    expect(updateMode).toEqual({
      value,
      source,
      global,
      ...(groupMode ? { group: groupMode } : {}),
    });
  });
});

describe('exclusions', () => {
  test('names the container exclusion and the group entries separately', () => {
    const c = container(
      { actionTriggerExclude: 'command.backup' },
      snapshot({ actions: { exclude: ['docker.local:major'] } }),
    );
    expect(resolve(c).actions.exclude).toEqual({
      label: 'command.backup',
      labelSource: 'label',
      group: ['docker.local:major'],
    });
  });

  test('says when a Drydock override owns the container exclusion, from either projection', () => {
    const sources = { actionTriggerExclude: 'override' } as const;
    const stored = container({
      actionTriggerExclude: 'docker.local',
      labelOwned: { v: 1, declared: {}, declaredSources: {}, sources } as never,
    });
    const projected = container({
      actionTriggerExclude: 'docker.local',
      labelOwnedSources: sources,
    } as never);
    expect(resolve(stored).actions.exclude.labelSource).toBe('override');
    expect(resolve(projected).actions.exclude.labelSource).toBe('override');
  });

  test('an override that cleared the exclusion is still attributed', () => {
    const c = container({
      labelOwnedSources: { actionTriggerExclude: 'override' },
    } as never);
    expect(resolve(c).actions.exclude).toEqual({ labelSource: 'override', group: [] });
  });

  test('reports nothing when nothing excludes', () => {
    expect(resolve(container()).actions.exclude).toEqual({ group: [] });
  });
});

describe('dispatch', () => {
  test('an open docker trigger auto-dispatches under global auto', () => {
    const { dispatch } = resolve(container()).actions;
    expect(dispatch).toEqual({
      automatic: true,
      trigger: { id: 'docker.local', state: 'auto' },
      manualUpdate: { allowed: true },
    });
  });

  test('a group manual ceiling keeps the winner but stops automatic dispatch', () => {
    const c = container({}, snapshot({ actions: { updateMode: 'manual' } }));
    expect(resolve(c).actions.dispatch).toEqual({
      automatic: false,
      trigger: { id: 'docker.local', state: 'auto' },
      manualUpdate: { allowed: true },
    });
  });

  test('a group notify ceiling blocks manual updates with the eligibility blocker', () => {
    const c = container({}, snapshot({ actions: { updateMode: 'notify' } }));
    expect(resolve(c, 'manual').actions.dispatch).toMatchObject({
      automatic: false,
      manualUpdate: { allowed: false, blockedBy: 'group-notify-only' },
    });
  });

  test('a group notify ceiling is still the blocker when global is also notify', () => {
    const c = container({}, snapshot({ actions: { updateMode: 'notify' } }));
    expect(resolve(c, 'notify').actions.dispatch.manualUpdate).toEqual({
      allowed: false,
      blockedBy: 'group-notify-only',
    });
  });

  test('global notify blocks manual updates with no group blocker', () => {
    expect(resolve(container(), 'notify').actions.dispatch.manualUpdate).toEqual({
      allowed: false,
      blockedBy: 'global-notify',
    });
  });

  test('a group exclusion is a hard stop attributed to the group', () => {
    const t = {
      'dockercompose.stack': trigger('dockercompose.stack'),
      'docker.local': trigger('docker.local'),
    };
    const c = container(
      { actionTriggerInclude: 'dockercompose.stack' },
      snapshot({ actions: { exclude: ['dockercompose.stack'] } }),
    );
    expect(resolve(c, 'auto', t).actions.dispatch).toEqual({
      automatic: false,
      trigger: {
        id: 'dockercompose.stack',
        state: 'blocked',
        reason: 'excluded',
        excludedBy: 'group',
      },
      manualUpdate: { allowed: false, blockedBy: 'trigger-excluded' },
    });
  });

  test('a container exclusion wins the attribution over the group one', () => {
    const c = container(
      { actionTriggerExclude: 'docker.local' },
      snapshot({ actions: { exclude: ['docker.local'] } }),
    );
    expect(resolve(c).actions.dispatch.trigger).toMatchObject({ excludedBy: 'label' });
  });

  test('no compatible trigger means no winner, and nothing dispatches', () => {
    expect(resolve(container(), 'auto', {}).actions.dispatch).toEqual({
      automatic: false,
      trigger: null,
      manualUpdate: { allowed: false, blockedBy: 'no-trigger' },
    });
  });

  test('an include-only trigger selects as manual and is not automatic', () => {
    const t = { 'docker.local': trigger('docker.local', {}, 'onauto') };
    const c = container({ actionTriggerInclude: 'docker.local' });
    expect(resolve(c, 'auto', t).actions.dispatch).toEqual({
      automatic: false,
      trigger: { id: 'docker.local', state: 'manual' },
      manualUpdate: { allowed: true },
    });
  });
});
