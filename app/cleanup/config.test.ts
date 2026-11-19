import { ddEnvVars } from '../configuration/index.js';
import { getCleanupPolicies } from './config.js';

const PREFIX = 'DD_CLEANUP_';

function setEnv(values: Record<string, string>) {
  for (const key of Object.keys(ddEnvVars)) {
    if (key.startsWith(PREFIX)) {
      delete ddEnvVars[key];
    }
  }
  Object.assign(ddEnvVars, values);
}

describe('getCleanupPolicies', () => {
  afterEach(() => setEnv({}));

  test('returns no policies when nothing is configured', () => {
    setEnv({});
    expect(getCleanupPolicies()).toEqual([]);
  });

  test('parses a full policy', () => {
    setEnv({
      DD_CLEANUP_NIGHTLY_CRON: '0 3 * * *',
      DD_CLEANUP_NIGHTLY_CHECKCRON: '*/5 * * * *',
      DD_CLEANUP_NIGHTLY_THRESHOLDBYTES: '1000',
      DD_CLEANUP_NIGHTLY_HOSTS: 'docker.local, edge.docker.local,',
      DD_CLEANUP_NIGHTLY_DANGLINGIMAGES: 'true',
      DD_CLEANUP_NIGHTLY_UNUSEDIMAGES: 'true',
      DD_CLEANUP_NIGHTLY_UNUSEDIMAGESOLDERTHANHOURS: '48',
      DD_CLEANUP_NIGHTLY_STOPPEDCONTAINERS: 'true',
      DD_CLEANUP_NIGHTLY_NETWORKS: 'true',
      DD_CLEANUP_NIGHTLY_BUILDCACHE: 'true',
      DD_CLEANUP_NIGHTLY_VOLUMES: 'true',
      DD_CLEANUP_NIGHTLY_VOLUMESCONFIRM: 'true',
      DD_CLEANUP_NIGHTLY_PROTECTHOURS: '24',
      DD_CLEANUP_NIGHTLY_DRYRUN: 'true',
    });
    expect(getCleanupPolicies()).toEqual([
      {
        name: 'nightly',
        cron: '0 3 * * *',
        checkCron: '*/5 * * * *',
        thresholdBytes: 1000,
        hosts: ['docker.local', 'edge.docker.local'],
        types: {
          danglingImages: true,
          unusedImages: true,
          stoppedContainers: true,
          networks: true,
          buildCache: true,
          volumes: true,
        },
        unusedImagesOlderThanHours: 48,
        protectHours: 24,
        dryRun: true,
      },
    ]);
  });

  test('applies defaults and omits the threshold when unset', () => {
    setEnv({ DD_CLEANUP_WEEKLY_CRON: '0 4 * * 0', DD_CLEANUP_WEEKLY_DANGLINGIMAGES: 'true' });
    const [policy] = getCleanupPolicies();
    expect(policy).toMatchObject({
      name: 'weekly',
      checkCron: '*/15 * * * *',
      hosts: [],
      protectHours: 168,
      dryRun: false,
      unusedImagesOlderThanHours: 0,
    });
    expect(policy).not.toHaveProperty('thresholdBytes');
  });

  test('allows a threshold-only policy', () => {
    setEnv({ DD_CLEANUP_DISK_THRESHOLDBYTES: '5', DD_CLEANUP_DISK_NETWORKS: 'true' });
    expect(getCleanupPolicies()[0]).toMatchObject({ cron: '', thresholdBytes: 5 });
  });

  test('rejects volumes without the separate confirmation', () => {
    setEnv({ DD_CLEANUP_VOL_CRON: '0 3 * * *', DD_CLEANUP_VOL_VOLUMES: 'true' });
    expect(() => getCleanupPolicies()).toThrow(/VOLUMESCONFIRM/);
  });

  test('rejects a policy with neither cron nor threshold', () => {
    setEnv({ DD_CLEANUP_X_NETWORKS: 'true' });
    expect(() => getCleanupPolicies()).toThrow(/CRON/);
  });

  test('rejects a policy that enables no prune type', () => {
    setEnv({ DD_CLEANUP_X_CRON: '0 3 * * *' });
    expect(() => getCleanupPolicies()).toThrow(/no prune type/);
  });

  test('rejects an invalid cron expression and unknown options', () => {
    setEnv({ DD_CLEANUP_X_CRON: 'nope', DD_CLEANUP_X_NETWORKS: 'true' });
    expect(() => getCleanupPolicies()).toThrow(/Invalid DD_CLEANUP_X/);
    setEnv({ DD_CLEANUP_X_CRON: '0 3 * * *', DD_CLEANUP_X_BOGUS: 'true' });
    expect(() => getCleanupPolicies()).toThrow(/Invalid DD_CLEANUP_X/);
  });
});
