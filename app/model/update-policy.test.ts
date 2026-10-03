import { createContainerFixture } from '../test/helpers.js';
import type { Container, ContainerGroupPolicySnapshot } from './container.js';
import {
  applyDeclarativeUpdatePolicy,
  applyGroupUpdatePolicyLayer,
  applyUpdatePolicyOverrides,
  getUpdatePolicyOverrides,
  resolveUpdatePolicyLayers,
} from './update-policy.js';

function groupSnapshot(
  updatePolicy: ContainerGroupPolicySnapshot['updatePolicy'],
): ContainerGroupPolicySnapshot {
  return { id: 'policy-1', group: 'payments', revision: 1, updatePolicy, actions: {} };
}

describe('update policy layers', () => {
  test('resolves each field independently from env, label, and override tiers', () => {
    const result = resolveUpdatePolicyLayers(
      {
        env: {
          maturityMode: 'mature',
          maturityMinAgeDays: 7,
          skipTags: ['env-tag'],
          skipDigests: ['env-digest'],
        },
        label: { maturityMinAgeDays: 14, skipTags: ['label-tag'] },
      },
      { maturityMode: 'all', skipTags: [], snoozeUntil: '2030-01-01T00:00:00.000Z' },
    );

    expect(result).toEqual({
      updatePolicy: {
        maturityMode: 'all',
        maturityMinAgeDays: 14,
        skipTags: [],
        skipDigests: ['env-digest'],
        snoozeUntil: '2030-01-01T00:00:00.000Z',
      },
      updatePolicySources: {
        maturityMode: 'override',
        maturityMinAgeDays: 'label',
        skipTags: 'override',
        skipDigests: 'env',
      },
    });
  });

  test('returns no effective policy when every layer is empty', () => {
    expect(resolveUpdatePolicyLayers({ env: {}, label: {} })).toEqual({
      updatePolicy: undefined,
      updatePolicySources: {},
    });
  });

  test('lazily treats a legacy flat policy as the controller override', () => {
    const legacy = createContainerFixture({ updatePolicy: { skipTags: ['legacy'] } });

    expect(getUpdatePolicyOverrides(legacy)).toEqual({ skipTags: ['legacy'] });
    applyDeclarativeUpdatePolicy(legacy, {
      env: { maturityMode: 'mature' },
      label: { skipTags: ['label'] },
    });

    expect(legacy.updatePolicy).toEqual({ maturityMode: 'mature', skipTags: ['legacy'] });
    expect(legacy.updatePolicyOverrides).toEqual({ skipTags: ['legacy'] });
    expect(legacy.updatePolicySources).toEqual({ maturityMode: 'env', skipTags: 'override' });
  });

  test('uses existing layered overrides and does not infer effective values as overrides', () => {
    const layered = createContainerFixture({
      updatePolicy: { maturityMode: 'mature' },
      updatePolicyDeclarative: { env: { maturityMode: 'mature' }, label: {} },
      updatePolicyOverrides: {},
    });

    expect(getUpdatePolicyOverrides(layered)).toEqual({});
    delete layered.updatePolicyOverrides;
    expect(getUpdatePolicyOverrides(layered)).toEqual({});
  });

  test('applies controller overrides to a built-in empty declarative baseline', () => {
    const container = createContainerFixture();

    applyUpdatePolicyOverrides(container, { skipDigests: [] });

    expect(container.updatePolicyDeclarative).toEqual({ env: {}, label: {} });
    expect(container.updatePolicy).toEqual({ skipDigests: [] });
    expect(container.updatePolicySources).toEqual({ skipDigests: 'override' });
  });
});

describe('group update-policy layer', () => {
  test('sits between env and label for every declarative field', () => {
    const allFields = {
      maturityMode: 'mature' as const,
      maturityMinAgeDays: 9,
      skipTags: ['group-tag'],
      skipDigests: ['group-digest'],
    };

    expect(
      resolveUpdatePolicyLayers(
        {
          env: {
            maturityMode: 'all',
            maturityMinAgeDays: 2,
            skipTags: ['env-tag'],
            skipDigests: ['env-digest'],
          },
          label: {},
        },
        {},
        allFields,
      ),
    ).toEqual({
      updatePolicy: allFields,
      updatePolicySources: {
        maturityMode: 'group',
        maturityMinAgeDays: 'group',
        skipTags: 'group',
        skipDigests: 'group',
      },
    });

    expect(
      resolveUpdatePolicyLayers(
        {
          env: {},
          label: { maturityMode: 'all', skipTags: ['label-tag'] },
        },
        { skipDigests: [] },
        allFields,
      ),
    ).toEqual({
      updatePolicy: {
        maturityMode: 'all',
        maturityMinAgeDays: 9,
        skipTags: ['label-tag'],
        skipDigests: [],
      },
      updatePolicySources: {
        maturityMode: 'label',
        maturityMinAgeDays: 'group',
        skipTags: 'label',
        skipDigests: 'override',
      },
    });
  });

  test('leaves a field the group does not set to the layers below it, or the built-in default', () => {
    expect(
      resolveUpdatePolicyLayers({ env: { maturityMinAgeDays: 4 }, label: {} }, {}, {}),
    ).toEqual({
      updatePolicy: { maturityMinAgeDays: 4 },
      updatePolicySources: { maturityMinAgeDays: 'env' },
    });
    expect(resolveUpdatePolicyLayers({ env: {}, label: {} }, {}, {})).toEqual({
      updatePolicy: undefined,
      updatePolicySources: {},
    });
  });

  test('copies group lists rather than sharing them with the snapshot', () => {
    const group = { skipTags: ['shared'] };
    const resolved = resolveUpdatePolicyLayers({ env: {}, label: {} }, {}, group);

    resolved.updatePolicy?.skipTags?.push('mutated');

    expect(group.skipTags).toEqual(['shared']);
  });

  test('converts a legacy record before layering, so group values are never read back as overrides', () => {
    const legacy = createContainerFixture({
      updatePolicy: { maturityMinAgeDays: 3, snoozeUntil: '2030-01-01T00:00:00.000Z' },
    }) as Container;

    applyGroupUpdatePolicyLayer(legacy, groupSnapshot({ maturityMode: 'mature' }));

    expect(legacy.updatePolicyDeclarative).toEqual({ env: {}, label: {} });
    expect(legacy.updatePolicyOverrides).toEqual({
      maturityMinAgeDays: 3,
      snoozeUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(legacy.updatePolicy).toEqual({
      maturityMode: 'mature',
      maturityMinAgeDays: 3,
      snoozeUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(legacy.updatePolicySources).toEqual({
      maturityMode: 'group',
      maturityMinAgeDays: 'override',
    });
    expect(getUpdatePolicyOverrides(legacy)).toEqual({
      maturityMinAgeDays: 3,
      snoozeUntil: '2030-01-01T00:00:00.000Z',
    });

    applyGroupUpdatePolicyLayer(legacy, undefined);

    expect(legacy.updatePolicy).toEqual({
      maturityMinAgeDays: 3,
      snoozeUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(legacy.updatePolicySources).toEqual({ maturityMinAgeDays: 'override' });
    expect(legacy).not.toHaveProperty('groupPolicy');
  });

  test('records a copy of the snapshot and drops it when no policy applies', () => {
    const layered = createContainerFixture({
      updatePolicyDeclarative: { env: { maturityMode: 'all' }, label: {} },
      updatePolicyOverrides: {},
    }) as Container;
    const snapshot = groupSnapshot({ maturityMode: 'mature' });

    applyGroupUpdatePolicyLayer(layered, snapshot);
    snapshot.updatePolicy.maturityMode = 'all';

    expect(layered.groupPolicy?.updatePolicy).toEqual({ maturityMode: 'mature' });
    expect(layered.updatePolicy).toEqual({ maturityMode: 'mature' });
    expect(layered.updatePolicySources).toEqual({ maturityMode: 'group' });

    applyGroupUpdatePolicyLayer(layered, undefined);

    expect(layered).not.toHaveProperty('groupPolicy');
    expect(layered.updatePolicy).toEqual({ maturityMode: 'all' });
    expect(layered.updatePolicySources).toEqual({ maturityMode: 'env' });
  });
});
