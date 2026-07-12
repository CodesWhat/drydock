import { createContainerFixture } from '../../../test/helpers.js';
import {
  applyDockerDeclarativeUpdatePolicy,
  resolveDockerDeclarativeUpdatePolicy,
} from './update-policy.js';

describe('Docker declarative update policy', () => {
  test('parses watcher maturity defaults and exact dd.updatePolicy labels', () => {
    expect(
      resolveDockerDeclarativeUpdatePolicy(
        {
          'dd.updatePolicy.maturityMode': 'all',
          'dd.updatePolicy.maturityMinAgeDays': '14',
          'dd.updatePolicy.skipTags': ' 1.0.0,2.0.0,1.0.0 ',
          'dd.updatePolicy.skipDigests': 'sha256:a, sha256:b',
        },
        { maturitymode: 'mature', maturityminagedays: '7' },
      ),
    ).toEqual({
      env: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      label: {
        maturityMode: 'all',
        maturityMinAgeDays: 14,
        skipTags: ['1.0.0', '2.0.0'],
        skipDigests: ['sha256:a', 'sha256:b'],
      },
    });
  });

  test('ignores malformed values, empty CSV labels, and wrong value types', () => {
    expect(
      resolveDockerDeclarativeUpdatePolicy(
        {
          'dd.updatePolicy.maturityMode': 'fresh',
          'dd.updatePolicy.maturityMinAgeDays': '0',
          'dd.updatePolicy.skipTags': ' , ',
        },
        { maturitymode: 42, maturityminagedays: '366' },
      ),
    ).toEqual({ env: {}, label: {} });
    expect(
      resolveDockerDeclarativeUpdatePolicy({
        'dd.updatePolicy.skipDigests': undefined as unknown as string,
      }),
    ).toEqual({ env: {}, label: {} });
  });

  test('applies declarations while preserving a controller override', () => {
    const container = createContainerFixture({
      updatePolicyOverrides: { maturityMode: 'all' },
    });

    applyDockerDeclarativeUpdatePolicy(
      container,
      { 'dd.updatePolicy.maturityMinAgeDays': '14' },
      { maturitymode: 'mature', maturityminagedays: 7 },
    );

    expect(container.updatePolicy).toEqual({ maturityMode: 'all', maturityMinAgeDays: 14 });
    expect(container.updatePolicySources).toEqual({
      maturityMode: 'override',
      maturityMinAgeDays: 'label',
    });
  });
});
