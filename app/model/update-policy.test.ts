import { createContainerFixture } from '../test/helpers.js';
import {
  applyDeclarativeUpdatePolicy,
  applyUpdatePolicyOverrides,
  getUpdatePolicyOverrides,
  resolveUpdatePolicyLayers,
} from './update-policy.js';

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
