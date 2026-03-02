// @ts-nocheck
import { describe, expect, test, vi } from 'vitest';
import ContainerRuntimeConfigManager from './ContainerRuntimeConfigManager.js';

function createManager(overrides = {}) {
  return new ContainerRuntimeConfigManager({
    getPreferredLabelValue: (labels, ddKey, wudKey) => labels?.[ddKey] ?? labels?.[wudKey],
    getLogger: () => ({ warn: vi.fn() }),
    ...overrides,
  });
}

function createLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
  };
}

describe('ContainerRuntimeConfigManager', () => {
  test('constructor should provide a default logger factory when omitted', () => {
    const manager = new ContainerRuntimeConfigManager({
      getPreferredLabelValue: () => undefined,
    });

    expect(manager.getLogger()).toBeUndefined();
  });

  test('sanitizeEndpointConfig should return empty object when endpoint config is missing', () => {
    const manager = createManager();

    expect(manager.sanitizeEndpointConfig(undefined, 'container-id')).toEqual({});
    expect(manager.sanitizeEndpointConfig(null, 'container-id')).toEqual({});
    expect(
      manager.sanitizeEndpointConfig(
        {
          Aliases: [],
        },
        'container-id',
      ),
    ).toEqual({});
  });

  test('sanitizeEndpointConfig should keep supported fields and remove self aliases', () => {
    const manager = createManager();

    const sanitized = manager.sanitizeEndpointConfig(
      {
        IPAMConfig: { IPv4Address: '10.0.0.8' },
        Links: ['a:b'],
        DriverOpts: { mtu: '1450' },
        MacAddress: '02:42:ac:11:00:02',
        Aliases: ['container', 'peer'],
        Ignored: true,
      },
      'container-123',
    );

    expect(sanitized).toEqual({
      IPAMConfig: { IPv4Address: '10.0.0.8' },
      Links: ['a:b'],
      DriverOpts: { mtu: '1450' },
      MacAddress: '02:42:ac:11:00:02',
      Aliases: ['peer'],
    });
  });

  test('getPrimaryNetworkName should honor explicit network mode and fallback to first network', () => {
    const manager = createManager();

    expect(
      manager.getPrimaryNetworkName({ HostConfig: { NetworkMode: 'custom-net' } }, [
        'bridge',
        'custom-net',
      ]),
    ).toBe('custom-net');

    expect(
      manager.getPrimaryNetworkName({ HostConfig: { NetworkMode: 'missing-net' } }, ['bridge']),
    ).toBe('bridge');
  });

  test('normalizeContainerProcessArgs and areContainerProcessArgsEqual should normalize scalar and array values', () => {
    const manager = createManager();

    expect(manager.normalizeContainerProcessArgs(undefined)).toBeUndefined();
    expect(manager.normalizeContainerProcessArgs([1, true, 'x'])).toEqual(['1', 'true', 'x']);
    expect(manager.normalizeContainerProcessArgs(42)).toEqual(['42']);

    expect(manager.areContainerProcessArgsEqual(undefined, undefined)).toBe(true);
    expect(manager.areContainerProcessArgsEqual(undefined, ['x'])).toBe(false);
    expect(manager.areContainerProcessArgsEqual([1, 2], ['1', '2'])).toBe(true);
    expect(manager.areContainerProcessArgsEqual(['1'], ['1', '2'])).toBe(false);
  });

  test('normalizeRuntimeFieldOrigin should normalize known values and fallback to unknown', () => {
    const manager = createManager();

    expect(manager.normalizeRuntimeFieldOrigin('EXPLICIT')).toBe('explicit');
    expect(manager.normalizeRuntimeFieldOrigin('inherited')).toBe('inherited');
    expect(manager.normalizeRuntimeFieldOrigin('other')).toBe('unknown');
    expect(manager.normalizeRuntimeFieldOrigin(undefined)).toBe('unknown');
  });

  test('getRuntimeFieldOrigin should prefer labels then infer inherited when field is undefined', () => {
    const manager = createManager();

    expect(
      manager.getRuntimeFieldOrigin(
        {
          Labels: {
            'dd.runtime.entrypoint.origin': 'explicit',
          },
          Entrypoint: ['/custom-entrypoint.sh'],
        },
        'Entrypoint',
      ),
    ).toBe('explicit');

    expect(
      manager.getRuntimeFieldOrigin(
        {
          Labels: {
            'dd.runtime.cmd.origin': 'unexpected-value',
          },
          Cmd: undefined,
        },
        'Cmd',
      ),
    ).toBe('inherited');

    expect(
      manager.getRuntimeFieldOrigin(
        {
          Labels: {
            'dd.runtime.cmd.origin': 'unexpected-value',
          },
          Cmd: ['run'],
        },
        'Cmd',
      ),
    ).toBe('unknown');
  });

  test('getRuntimeFieldOrigins should return both Entrypoint and Cmd origins', () => {
    const manager = createManager();

    expect(
      manager.getRuntimeFieldOrigins({
        Labels: {
          'dd.runtime.entrypoint.origin': 'inherited',
        },
        Entrypoint: ['/entrypoint.sh'],
      }),
    ).toEqual({
      Entrypoint: 'inherited',
      Cmd: 'inherited',
    });
  });

  test('annotateClonedRuntimeFieldOrigins should preserve inherited fields and mark explicit overrides', () => {
    const manager = createManager();

    const annotated = manager.annotateClonedRuntimeFieldOrigins(
      {
        Labels: {
          keep: 'true',
        },
        Entrypoint: ['/custom-entrypoint.sh'],
        Cmd: ['run'],
      },
      {
        Entrypoint: 'inherited',
        Cmd: 'unknown',
      },
      {
        Entrypoint: ['/default-entrypoint.sh'],
        Cmd: ['run'],
      },
    );

    expect(annotated.Labels.keep).toBe('true');
    expect(annotated.Labels['dd.runtime.entrypoint.origin']).toBe('explicit');
    expect(annotated.Labels['dd.runtime.cmd.origin']).toBe('explicit');

    const inheritedOnly = manager.annotateClonedRuntimeFieldOrigins(
      { Labels: {}, Entrypoint: ['/default-entrypoint.sh'] },
      { Entrypoint: 'inherited' },
      { Entrypoint: ['/default-entrypoint.sh'] },
    );

    expect(inheritedOnly.Labels['dd.runtime.entrypoint.origin']).toBe('inherited');
    expect(inheritedOnly.Labels['dd.runtime.cmd.origin']).toBe('inherited');

    const withMissingConfig = manager.annotateClonedRuntimeFieldOrigins(
      undefined,
      {},
      { Entrypoint: ['/default-entrypoint.sh'], Cmd: ['run'] },
    );
    expect(withMissingConfig.Labels['dd.runtime.entrypoint.origin']).toBe('inherited');
    expect(withMissingConfig.Labels['dd.runtime.cmd.origin']).toBe('inherited');
  });

  test('buildCloneRuntimeConfigOptions should preserve runtime option objects and support legacy log argument', () => {
    const manager = createManager();
    const logContainer = { info: vi.fn() };

    expect(manager.buildCloneRuntimeConfigOptions(undefined)).toEqual({});

    const options = {
      sourceImageConfig: { Cmd: ['one'] },
      targetImageConfig: { Cmd: ['two'] },
      runtimeFieldOrigins: { Cmd: 'inherited' },
      logContainer,
    };

    expect(manager.buildCloneRuntimeConfigOptions(options)).toBe(options);
    expect(manager.buildCloneRuntimeConfigOptions(logContainer)).toEqual({ logContainer });
  });

  test('sanitizeClonedRuntimeConfig should drop stale inherited runtime values and keep safe values', () => {
    const manager = createManager();
    const log = createLog();

    const removedStaleEntrypoint = manager.sanitizeClonedRuntimeConfig(
      {
        Entrypoint: ['/old-entrypoint.sh'],
        Cmd: ['from-source'],
      },
      {
        Entrypoint: ['/old-entrypoint.sh'],
        Cmd: ['from-source'],
      },
      {
        Entrypoint: ['/new-entrypoint.sh'],
        Cmd: ['from-source'],
      },
      {
        Entrypoint: 'inherited',
        Cmd: 'inherited',
      },
      log,
    );

    expect(removedStaleEntrypoint).toEqual({
      Cmd: ['from-source'],
    });
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Dropping stale Entrypoint'));

    const preserveUnknownOrigin = manager.sanitizeClonedRuntimeConfig(
      {
        Cmd: ['from-source'],
      },
      {
        Cmd: ['from-source'],
      },
      {
        Cmd: ['new-default'],
      },
      {
        Cmd: 'unknown',
      },
      log,
    );

    expect(preserveUnknownOrigin).toEqual({ Cmd: ['from-source'] });
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('runtime origin is unknown'));

    const preserveExplicitOverride = manager.sanitizeClonedRuntimeConfig(
      {
        Entrypoint: ['/custom-entrypoint.sh'],
      },
      {
        Entrypoint: ['/source-entrypoint.sh'],
      },
      {
        Entrypoint: ['/target-entrypoint.sh'],
      },
      {
        Entrypoint: 'inherited',
      },
      log,
    );

    expect(preserveExplicitOverride).toEqual({ Entrypoint: ['/custom-entrypoint.sh'] });

    expect(
      manager.sanitizeClonedRuntimeConfig(
        {
          Cmd: ['from-source'],
        },
        {
          Cmd: ['from-source'],
        },
        {
          Cmd: ['target-default'],
        },
        {
          Cmd: 'explicit',
        },
        log,
      ),
    ).toEqual({
      Cmd: ['from-source'],
    });

    expect(
      manager.sanitizeClonedRuntimeConfig(
        undefined,
        { Entrypoint: ['/source-entrypoint.sh'] },
        { Entrypoint: ['/target-entrypoint.sh'] },
        {},
        log,
      ),
    ).toEqual({});
  });

  test('inspectImageConfig should handle missing api methods, successful inspect, and inspect failures', async () => {
    const manager = createManager();
    const log = createLog();

    await expect(manager.inspectImageConfig(undefined, 'nginx:latest', log)).resolves.toBeUndefined();
    await expect(
      manager.inspectImageConfig({ getImage: vi.fn() }, undefined, log),
    ).resolves.toBeUndefined();

    const dockerApi = {
      getImage: vi.fn().mockResolvedValue({
        inspect: vi.fn().mockResolvedValue({ Config: { Entrypoint: ['/entry'] } }),
      }),
    };

    await expect(manager.inspectImageConfig(dockerApi, 'nginx:latest', log)).resolves.toEqual({
      Entrypoint: ['/entry'],
    });

    const dockerApiWithoutInspect = {
      getImage: vi.fn().mockResolvedValue({}),
    };
    await expect(
      manager.inspectImageConfig(dockerApiWithoutInspect, 'nginx:latest', log),
    ).resolves.toBeUndefined();

    const failingDockerApi = {
      getImage: vi.fn().mockRejectedValue(new Error('registry down')),
    };
    await expect(manager.inspectImageConfig(failingDockerApi, 'nginx:latest', log)).resolves.toBeUndefined();
    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Unable to inspect image nginx:latest for runtime defaults'),
    );
  });

  test('getCloneRuntimeConfigOptions should inspect source and target images and include runtime origins', async () => {
    const manager = createManager();
    const log = createLog();
    const inspectImageConfig = vi
      .spyOn(manager, 'inspectImageConfig')
      .mockResolvedValueOnce({ Entrypoint: ['/source-entry'] })
      .mockResolvedValueOnce({ Entrypoint: ['/target-entry'] });

    const options = await manager.getCloneRuntimeConfigOptions(
      { marker: true },
      {
        Config: {
          Image: 'registry/source:1.0.0',
          Entrypoint: ['/custom-entry'],
          Labels: {
            'dd.runtime.entrypoint.origin': 'explicit',
          },
        },
      },
      'registry/target:2.0.0',
      log,
    );

    expect(inspectImageConfig).toHaveBeenNthCalledWith(
      1,
      { marker: true },
      'registry/source:1.0.0',
      log,
    );
    expect(inspectImageConfig).toHaveBeenNthCalledWith(
      2,
      { marker: true },
      'registry/target:2.0.0',
      log,
    );

    expect(options).toEqual({
      sourceImageConfig: { Entrypoint: ['/source-entry'] },
      targetImageConfig: { Entrypoint: ['/target-entry'] },
      runtimeFieldOrigins: {
        Entrypoint: 'explicit',
        Cmd: 'inherited',
      },
      logContainer: log,
    });

    inspectImageConfig.mockReset();
    inspectImageConfig.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

    await manager.getCloneRuntimeConfigOptions(
      { marker: true },
      {
        Image: 'registry/source-fallback:1.0.0',
        Config: {
          Cmd: ['run'],
        },
      },
      'registry/target:2.0.0',
      log,
    );

    expect(inspectImageConfig).toHaveBeenNthCalledWith(
      1,
      { marker: true },
      'registry/source-fallback:1.0.0',
      log,
    );
  });

  test('isRuntimeConfigCompatibilityError should detect runtime command failures', () => {
    const manager = createManager();

    expect(manager.isRuntimeConfigCompatibilityError(undefined)).toBe(false);
    expect(
      manager.isRuntimeConfigCompatibilityError(
        'OCI runtime create failed: exec: "entrypoint.sh": no such file or directory',
      ),
    ).toBe(true);
    expect(
      manager.isRuntimeConfigCompatibilityError(
        'OCI runtime create failed: exec: "entrypoint.sh": executable file not found in $PATH',
      ),
    ).toBe(true);
    expect(
      manager.isRuntimeConfigCompatibilityError(
        'OCI runtime create failed: exec: "entrypoint.sh": permission denied',
      ),
    ).toBe(true);
    expect(manager.isRuntimeConfigCompatibilityError('network timeout')).toBe(false);
  });

  test('buildRuntimeConfigCompatibilityError should wrap compatibility failures with rollback context', () => {
    const manager = createManager();

    expect(
      manager.buildRuntimeConfigCompatibilityError(
        new Error('network timeout'),
        'web',
        { Config: { Image: 'registry/source:1.0.0' } },
        'registry/target:2.0.0',
        true,
      ),
    ).toBeUndefined();

    const wrappedCompleted = manager.buildRuntimeConfigCompatibilityError(
      new Error('OCI runtime create failed: exec: "entrypoint.sh": permission denied'),
      'web',
      { Config: { Image: 'registry/source:1.0.0' } },
      'registry/target:2.0.0',
      true,
    );

    expect(wrappedCompleted).toBeInstanceOf(Error);
    expect(wrappedCompleted.message).toContain('Container web runtime command is incompatible');
    expect(wrappedCompleted.message).toContain('source image: registry/source:1.0.0');
    expect(wrappedCompleted.message).toContain('Rollback completed.');

    const wrappedAttempted = manager.buildRuntimeConfigCompatibilityError(
      'OCI runtime create failed: exec: "entrypoint.sh": no such file or directory',
      'api',
      undefined,
      'registry/target:2.1.0',
      false,
    );

    expect(wrappedAttempted.message).toContain('source image: unknown');
    expect(wrappedAttempted.message).toContain('Rollback attempted but did not fully complete.');
  });
});
