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

// Resolves an image reference the way the daemon does: a known reference
// returns its inspect payload, anything else is "No such image".
function createImageApi(images: Record<string, unknown>) {
  return {
    getImage: vi.fn((imageRef: string) => ({
      inspect: vi.fn(async () => {
        if (!Object.hasOwn(images, imageRef)) {
          throw new Error(`No such image: ${imageRef}`);
        }
        return images[imageRef];
      }),
    })),
  };
}

describe('ContainerRuntimeConfigManager', () => {
  test('constructor should provide a default logger factory when omitted', () => {
    const manager = new ContainerRuntimeConfigManager({
      getPreferredLabelValue: () => undefined,
    });

    expect(manager.getLogger()).toBeUndefined();
  });

  test('constructor should throw when required dependencies are missing', () => {
    expect(() => new ContainerRuntimeConfigManager({} as never)).toThrow(
      'ContainerRuntimeConfigManager requires dependency "getPreferredLabelValue"',
    );
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

  test('sanitizeEndpointConfig should keep supported fields, drop the auto-assigned MacAddress, and remove self aliases', () => {
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
      Aliases: ['peer'],
    });
  });

  test('sanitizeEndpointConfig should drop an auto-assigned-only MacAddress (no DesiredMacAddress, no legacy Config.MacAddress)', () => {
    const manager = createManager();

    const sanitized = manager.sanitizeEndpointConfig(
      {
        MacAddress: '02:42:ac:11:00:02',
      },
      'container-123',
    );

    expect(sanitized).not.toHaveProperty('MacAddress');
  });

  test('sanitizeEndpointConfig should forward DesiredMacAddress when present', () => {
    const manager = createManager();

    const sanitized = manager.sanitizeEndpointConfig(
      {
        MacAddress: '02:42:ac:11:00:02',
        DesiredMacAddress: '02:42:ac:11:00:99',
      },
      'container-123',
    );

    expect(sanitized.MacAddress).toBe('02:42:ac:11:00:99');
  });

  test('sanitizeEndpointConfig should fall back to the legacy container-wide Config.MacAddress when non-empty', () => {
    const manager = createManager();

    const sanitized = manager.sanitizeEndpointConfig(
      {
        MacAddress: '02:42:ac:11:00:02',
      },
      'container-123',
      '02:42:ac:11:00:77',
    );

    expect(sanitized.MacAddress).toBe('02:42:ac:11:00:77');
  });

  test('sanitizeEndpointConfig should prefer DesiredMacAddress over the legacy Config.MacAddress when both are present', () => {
    const manager = createManager();

    const sanitized = manager.sanitizeEndpointConfig(
      {
        MacAddress: '02:42:ac:11:00:02',
        DesiredMacAddress: '02:42:ac:11:00:99',
      },
      'container-123',
      '02:42:ac:11:00:77',
    );

    expect(sanitized.MacAddress).toBe('02:42:ac:11:00:99');
  });

  test('sanitizeEndpointConfig should drop MacAddress when legacy Config.MacAddress is an empty string', () => {
    const manager = createManager();

    const sanitized = manager.sanitizeEndpointConfig(
      {
        MacAddress: '02:42:ac:11:00:02',
      },
      'container-123',
      '',
    );

    expect(sanitized).not.toHaveProperty('MacAddress');
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

  test('getPrimaryNetworkName should translate NetworkMode "default" to "bridge" when present', () => {
    const manager = createManager();

    // A container created on the default bridge network reports
    // HostConfig.NetworkMode: "default" in docker inspect, not "bridge" (moby
    // special-cases this at create time). Without the translation, the
    // alphabetically-first network name would win instead — which for an
    // 'app-net' + 'bridge' container is 'app-net', the wrong network.
    expect(
      manager.getPrimaryNetworkName({ HostConfig: { NetworkMode: 'default' } }, [
        'app-net',
        'bridge',
      ]),
    ).toBe('bridge');
  });

  test('getPrimaryNetworkName should fall back to the first network when NetworkMode "default" has no bridge network', () => {
    const manager = createManager();

    expect(
      manager.getPrimaryNetworkName({ HostConfig: { NetworkMode: 'default' } }, [
        'app-net',
        'other-net',
      ]),
    ).toBe('app-net');
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

  describe('isInheritedRuntimeField', () => {
    test('INHERITED origin should delegate to inheritedFromSource', () => {
      const manager = createManager();
      const log = createLog();

      expect(manager.isInheritedRuntimeField('Entrypoint', 'inherited', true, true, log)).toBe(
        true,
      );
      expect(manager.isInheritedRuntimeField('Entrypoint', 'inherited', false, true, log)).toBe(
        false,
      );
    });

    test('EXPLICIT origin should always return false', () => {
      const manager = createManager();
      const log = createLog();

      expect(manager.isInheritedRuntimeField('Entrypoint', 'explicit', true, true, log)).toBe(
        false,
      );
      expect(manager.isInheritedRuntimeField('Entrypoint', 'explicit', false, false, log)).toBe(
        false,
      );
    });

    test('UNKNOWN origin + inheritedFromSource + sourceImageKnown → treat as inherited (drop stale value)', () => {
      const manager = createManager();
      const log = createLog();

      expect(manager.isInheritedRuntimeField('Entrypoint', 'unknown', true, true, log)).toBe(true);
      expect(log.debug).toHaveBeenCalledWith(
        expect.stringContaining('Treating Entrypoint as inherited'),
      );
    });

    test('UNKNOWN origin + inheritedFromSource + sourceImageUnknown → conservative keep', () => {
      const manager = createManager();
      const log = createLog();

      expect(manager.isInheritedRuntimeField('Entrypoint', 'unknown', true, false, log)).toBe(
        false,
      );
      expect(log.debug).toHaveBeenCalledWith(
        expect.stringContaining('origin unknown and source image unavailable'),
      );
    });

    test('UNKNOWN origin + not inherited from source → keep regardless of sourceImageKnown', () => {
      const manager = createManager();
      const log = createLog();

      expect(manager.isInheritedRuntimeField('Entrypoint', 'unknown', false, true, log)).toBe(
        false,
      );
      expect(manager.isInheritedRuntimeField('Entrypoint', 'unknown', false, false, log)).toBe(
        false,
      );
    });
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

    // UNKNOWN origin + source image known + value matches source → drop stale value
    const dropUnknownOriginWhenSourceKnown = manager.sanitizeClonedRuntimeConfig(
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

    expect(dropUnknownOriginWhenSourceKnown).toEqual({});
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Treating Cmd as inherited'));

    // UNKNOWN origin + source image unavailable → conservative keep (sourceImageConfig=undefined
    // means inheritedFromSource=false, so the value is treated as a potential explicit override)
    const preserveUnknownOriginNoSourceImage = manager.sanitizeClonedRuntimeConfig(
      {
        Cmd: ['from-source'],
      },
      undefined,
      {
        Cmd: ['new-default'],
      },
      {
        Cmd: 'unknown',
      },
      log,
    );

    expect(preserveUnknownOriginNoSourceImage).toEqual({ Cmd: ['from-source'] });

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

  test('sanitizeClonedRuntimeConfig should drop stale image-inherited env and labels', () => {
    const manager = createManager();
    const log = createLog();

    const result = manager.sanitizeClonedRuntimeConfig(
      {
        Env: ['DD_VERSION=1.5.0-rc.15'],
        Labels: {
          'org.opencontainers.image.version': '1.5.0-rc.15',
        },
      },
      {
        Env: ['DD_VERSION=1.5.0-rc.15'],
        Labels: {
          'org.opencontainers.image.version': '1.5.0-rc.15',
        },
      },
      {
        Env: ['DD_VERSION=1.5.0-rc.17'],
        Labels: {
          'org.opencontainers.image.version': '1.5.0-rc.17',
        },
      },
      {},
      log,
    );

    expect(result).toEqual({});
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('Dropping stale image-inherited environment variable DD_VERSION'),
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('Dropping stale image-inherited label'),
    );
  });

  test('sanitizeImageInheritedEnv should preserve explicit, unchanged, malformed, and untraceable env entries', () => {
    const manager = createManager();
    const log = createLog();
    const containerEnv = [
      'DD_VERSION=1.5.0-rc.15',
      'PATH=/usr/local/bin',
      'REMOVED=old',
      'PUID=1000',
      'NOVALUE',
      '=bad',
      null,
    ];
    const sourceImageConfig = {
      Env: ['DD_VERSION=1.5.0-rc.15', 'PATH=/usr/local/bin', 'REMOVED=old'],
    };
    const targetImageConfig = {
      Env: ['DD_VERSION=1.5.0-rc.17', 'PATH=/usr/local/bin'],
    };

    expect(
      manager.sanitizeImageInheritedEnv(containerEnv, sourceImageConfig, targetImageConfig, log),
    ).toEqual(['PATH=/usr/local/bin', 'PUID=1000', 'NOVALUE', '=bad', null]);
    expect(
      manager.sanitizeImageInheritedEnv(undefined, sourceImageConfig, targetImageConfig, log),
    ).toBeUndefined();
    expect(manager.sanitizeImageInheritedEnv(containerEnv, undefined, targetImageConfig, log)).toBe(
      containerEnv,
    );
    expect(manager.sanitizeImageInheritedEnv(containerEnv, sourceImageConfig, undefined, log)).toBe(
      containerEnv,
    );
    expect(
      manager.sanitizeImageInheritedEnv(containerEnv, { Env: [] }, targetImageConfig, log),
    ).toBe(containerEnv);
    expect(
      manager.sanitizeImageInheritedEnv(
        containerEnv,
        { Env: 'not-an-array' },
        targetImageConfig,
        log,
      ),
    ).toBe(containerEnv);

    const unchangedEnv = ['PATH=/usr/local/bin'];
    expect(
      manager.sanitizeImageInheritedEnv(
        unchangedEnv,
        { Env: ['PATH=/usr/local/bin', 'MALFORMED'] },
        { Env: ['PATH=/usr/local/bin'] },
        log,
      ),
    ).toBe(unchangedEnv);
  });

  test('sanitizeImageInheritedLabels should preserve runtime and unchanged labels', () => {
    const manager = createManager();
    const log = createLog();
    const labels = {
      'dd.watch': 'true',
      'org.opencontainers.image.title': 'Drydock',
      'org.opencontainers.image.version': '1.5.0-rc.15',
      custom: 'operator',
    };
    const sourceImageConfig = {
      Labels: {
        'org.opencontainers.image.title': 'Drydock',
        'org.opencontainers.image.version': '1.5.0-rc.15',
        custom: 'source-default',
      },
    };
    const targetImageConfig = {
      Labels: {
        'org.opencontainers.image.title': 'Drydock',
        'org.opencontainers.image.version': '1.5.0-rc.17',
      },
    };

    expect(
      manager.sanitizeImageInheritedLabels(labels, sourceImageConfig, targetImageConfig, log),
    ).toEqual({
      'dd.watch': 'true',
      'org.opencontainers.image.title': 'Drydock',
      custom: 'operator',
    });

    expect(
      manager.sanitizeImageInheritedLabels(undefined, sourceImageConfig, targetImageConfig, log),
    ).toBeUndefined();
    expect(manager.sanitizeImageInheritedLabels(labels, {}, targetImageConfig, log)).toBe(labels);
    expect(
      manager.sanitizeImageInheritedLabels(labels, { Labels: [] } as never, targetImageConfig, log),
    ).toBe(labels);
    expect(manager.sanitizeImageInheritedLabels(labels, sourceImageConfig, undefined, log)).toBe(
      labels,
    );
    expect(
      manager.sanitizeImageInheritedLabels(
        { 'org.opencontainers.image.version': '1.5.0-rc.15' },
        sourceImageConfig,
        { Labels: undefined },
        log,
      ),
    ).toEqual({});
    expect(
      manager.sanitizeImageInheritedLabels(
        { 'org.opencontainers.image.title': 'Drydock' },
        sourceImageConfig,
        targetImageConfig,
        log,
      ),
    ).toEqual({ 'org.opencontainers.image.title': 'Drydock' });
  });

  test('inspectImageConfig should handle missing api methods, successful inspect, and inspect failures', async () => {
    const manager = createManager();
    const log = createLog();

    await expect(
      manager.inspectImageConfig(undefined, 'nginx:latest', log),
    ).resolves.toBeUndefined();
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
    await expect(
      manager.inspectImageConfig(failingDockerApi, 'nginx:latest', log),
    ).resolves.toBeUndefined();
    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Unable to inspect image nginx:latest for runtime defaults'),
    );

    const nonErrorFailingDockerApi = {
      getImage: vi.fn().mockRejectedValue('raw failure'),
    };
    await expect(
      manager.inspectImageConfig(nonErrorFailingDockerApi, 'nginx:latest', log),
    ).resolves.toBeUndefined();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('(raw failure)'));
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

  test('getCloneRuntimeConfigOptions should include the daemon default runtime', async () => {
    const manager = createManager();
    const log = createLog();
    vi.spyOn(manager, 'inspectImageConfig')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const dockerApi = { info: vi.fn().mockResolvedValue({ DefaultRuntime: 'runc' }) };

    const options = await manager.getCloneRuntimeConfigOptions(
      dockerApi,
      { Config: { Image: 'registry/source:1.0.0' } },
      'registry/target:2.0.0',
      log,
    );

    expect(dockerApi.info).toHaveBeenCalledTimes(1);
    expect(options.defaultRuntime).toBe('runc');
  });

  describe('source image of a recreate', () => {
    // Image A is the one the container was created from, image B the one it
    // is being recreated on.
    const IMAGE_A = {
      Config: {
        Entrypoint: ['/entry-a.sh'],
        Cmd: ['serve', '--v1'],
        Env: ['PATH=/usr/bin', 'APP_VERSION=1'],
        Labels: { 'test.inherited': '1', maintainer: 'publisher' },
      },
    };
    const IMAGE_B = {
      Config: {
        Entrypoint: ['/entry-b.sh'],
        Cmd: ['serve', '--v2'],
        Env: ['PATH=/usr/bin', 'APP_VERSION=2'],
        Labels: { 'test.inherited': '2', maintainer: 'publisher' },
      },
    };
    const TARGET = 'repo/app:latest@sha256:b';
    // What is left once everything image A contributed and image B changed is
    // gone: the PATH and maintainer label both images agree on, and the label
    // the operator set.
    const REFRESHED = {
      Env: ['PATH=/usr/bin'],
      Labels: { maintainer: 'publisher', 'dd.watch': 'true' },
    };

    // What `docker inspect` reports for a container created from image A with
    // nothing of its own but a dd.watch label: Docker has merged the image's
    // Entrypoint, Cmd, Env and labels into Config.
    function containerOnImageA(configImage: string, configOverrides = {}) {
      return {
        Name: '/app',
        Image: 'sha256:image-a',
        Config: {
          Image: configImage,
          Entrypoint: [...IMAGE_A.Config.Entrypoint],
          Cmd: [...IMAGE_A.Config.Cmd],
          Env: [...IMAGE_A.Config.Env],
          Labels: { ...IMAGE_A.Config.Labels, 'dd.watch': 'true' },
          ...configOverrides,
        },
      };
    }

    // The two steps a recreate takes: resolve the clone options, then sanitise
    // the old container's config with them.
    async function sanitizeForRecreate(
      dockerApi: ReturnType<typeof createImageApi>,
      spec: { Image?: string; Config: Record<string, unknown> },
      newImage = TARGET,
    ) {
      const manager = createManager();
      const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };
      const options = await manager.getCloneRuntimeConfigOptions(dockerApi, spec, newImage, log);
      const config = manager.sanitizeClonedRuntimeConfig(
        spec.Config,
        options.sourceImageConfig,
        options.targetImageConfig,
        options.runtimeFieldOrigins,
        log,
        options.hookLabelProvenance,
      );
      return { config, options, manager };
    }

    test('a same-tag pull refreshes the inherited Entrypoint, Cmd, Env and labels from the image read by ID', async () => {
      // The pull has already moved repo/app:latest to image B.
      const dockerApi = createImageApi({
        'sha256:image-a': IMAGE_A,
        'repo/app:latest': IMAGE_B,
        [TARGET]: IMAGE_B,
      });

      const { config } = await sanitizeForRecreate(dockerApi, containerOnImageA('repo/app:latest'));

      expect(config).toEqual({ Image: 'repo/app:latest', ...REFRESHED });
      expect(dockerApi.getImage).toHaveBeenCalledWith('sha256:image-a');
      expect(dockerApi.getImage).not.toHaveBeenCalledWith('repo/app:latest');
    });

    test('an inherited Entrypoint follows the new image when it is the only thing that changed', async () => {
      const imageWithNewEntrypoint = {
        Config: { ...IMAGE_A.Config, Entrypoint: ['/entry-b.sh'] },
      };
      const dockerApi = createImageApi({
        'sha256:image-a': IMAGE_A,
        'repo/app:latest': imageWithNewEntrypoint,
        [TARGET]: imageWithNewEntrypoint,
      });
      const spec = containerOnImageA('repo/app:latest');

      const { config } = await sanitizeForRecreate(dockerApi, spec);

      expect(config).not.toHaveProperty('Entrypoint');
      expect(config.Cmd).toEqual(['serve', '--v1']);
      expect(config.Env).toBe(spec.Config.Env);
      expect(config.Labels).toBe(spec.Config.Labels);
    });

    test('a refreshed Entrypoint and Cmd are stamped as inherited on the recreated container', async () => {
      const dockerApi = createImageApi({
        'sha256:image-a': IMAGE_A,
        'repo/app:latest': IMAGE_B,
        [TARGET]: IMAGE_B,
      });

      const { config, options, manager } = await sanitizeForRecreate(
        dockerApi,
        containerOnImageA('repo/app:latest'),
      );
      const annotated = manager.annotateClonedRuntimeFieldOrigins(
        config,
        options.runtimeFieldOrigins,
        options.targetImageConfig,
      );

      expect(annotated.Labels).toEqual({
        ...REFRESHED.Labels,
        'dd.runtime.entrypoint.origin': 'inherited',
        'dd.runtime.cmd.origin': 'inherited',
      });
    });

    test('values the operator set survive a same-tag pull', async () => {
      const dockerApi = createImageApi({
        'sha256:image-a': IMAGE_A,
        'repo/app:latest': IMAGE_B,
        [TARGET]: IMAGE_B,
      });
      // A variable of their own, an override of an image variable, their own
      // entrypoint and an override of an image label. Cmd is left to the image.
      const operatorConfig = {
        Entrypoint: ['/operator-entry.sh'],
        Env: ['OPERATOR_VAR=x', 'APP_VERSION=custom', 'PATH=/usr/bin'],
        Labels: { 'test.inherited': 'mine', maintainer: 'publisher', 'dd.watch': 'true' },
      };

      const { config } = await sanitizeForRecreate(
        dockerApi,
        containerOnImageA('repo/app:latest', operatorConfig),
      );

      expect(config).toEqual({ Image: 'repo/app:latest', ...operatorConfig });
    });

    test.each([
      ['the tag@digest an earlier update pinned no longer resolves', 'repo/app:latest@sha256:a'],
      ['the old tag was untagged locally', 'repo/app:1.0.0'],
    ])('the inherited defaults still refresh when %s', async (_name, configImage) => {
      const dockerApi = createImageApi({ 'sha256:image-a': IMAGE_A, [TARGET]: IMAGE_B });

      const { config } = await sanitizeForRecreate(dockerApi, containerOnImageA(configImage));

      expect(config).toEqual({ Image: configImage, ...REFRESHED });
      expect(dockerApi.getImage).not.toHaveBeenCalledWith(configImage);
    });

    test('a container spec without an image ID falls back to Config.Image', async () => {
      const dockerApi = createImageApi({ 'repo/app:1.0.0': IMAGE_A, [TARGET]: IMAGE_B });
      const { Config } = containerOnImageA('repo/app:1.0.0');

      const { config } = await sanitizeForRecreate(dockerApi, { Config });

      expect(config).toEqual({ Image: 'repo/app:1.0.0', ...REFRESHED });
      expect(dockerApi.getImage).toHaveBeenCalledWith('repo/app:1.0.0');
    });

    test('an image ID that cannot be inspected keeps everything and is not retried by tag', async () => {
      // The image the container runs is gone. Its tag still resolves, to an
      // image whose defaults match the container, so falling back to the tag
      // would drop them.
      const dockerApi = createImageApi({ 'repo/app:latest': IMAGE_A, [TARGET]: IMAGE_B });
      const spec = { ...containerOnImageA('repo/app:latest'), Image: 'sha256:image-gone' };

      const { config, options } = await sanitizeForRecreate(dockerApi, spec);

      expect(options.sourceImageConfig).toBeUndefined();
      expect(config).toEqual(spec.Config);
      expect(dockerApi.getImage).toHaveBeenCalledWith('sha256:image-gone');
      expect(dockerApi.getImage).not.toHaveBeenCalledWith('repo/app:latest');
    });
  });

  describe('hook label provenance on recreate', () => {
    const BAKED_HOOK = { 'dd.hook.pre': 'echo baked' };

    function createHookLog() {
      return { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };
    }

    test('getHookLabelProvenance reports the labels of the image the container was created from', () => {
      const manager = createManager();
      const log = createHookLog();

      expect(
        manager.getHookLabelProvenance(
          {
            Name: '/app',
            Image: 'sha256:image-a',
            Config: { Image: 'repo/app:latest', Labels: { ...BAKED_HOOK, 'dd.watch': 'true' } },
          },
          { Labels: { ...BAKED_HOOK, maintainer: 'publisher' } },
          log,
        ),
      ).toEqual({ sourceImageLabels: { ...BAKED_HOOK, maintainer: 'publisher' } });

      expect(log.warn).not.toHaveBeenCalled();
    });

    test.each([
      ['an image config without a Labels key', {}],
      ['an image config with null Labels', { Labels: null }],
    ])(
      'getHookLabelProvenance treats %s as an image that bakes no labels',
      (_name, imageConfig) => {
        const manager = createManager();

        expect(
          manager.getHookLabelProvenance(
            {
              Name: '/app',
              Image: 'sha256:image-b',
              Config: { Labels: { 'dd.hook.post': 'echo op' } },
            },
            imageConfig,
            createHookLog(),
          ),
        ).toEqual({ sourceImageLabels: {} });
      },
    );

    test.each([
      [
        'only non-hook labels',
        { Image: 'sha256:image-a', Config: { Labels: { 'dd.watch': 'true' } } },
      ],
      ['an empty label set', { Image: 'sha256:image-a', Config: { Labels: {} } }],
      ['no labels', { Image: 'sha256:image-a', Config: {} }],
      ['no config', { Image: 'sha256:image-a' }],
      ['no container spec', undefined],
    ])('getHookLabelProvenance reports nothing for a container with %s', (_name, spec) => {
      const manager = createManager();
      const log = createHookLog();

      // Not even when the image could not be read: there is nothing to verify.
      expect(manager.getHookLabelProvenance(spec, { Labels: BAKED_HOOK }, log)).toBeUndefined();
      expect(manager.getHookLabelProvenance(spec, undefined, log)).toBeUndefined();
      expect(log.warn).not.toHaveBeenCalled();
    });

    test('getHookLabelProvenance reports unknown provenance and warns when the image could not be read', () => {
      const manager = createManager();
      const log = createHookLog();

      expect(
        manager.getHookLabelProvenance(
          {
            Name: '/app',
            Image: 'sha256:image-gone',
            Config: {
              Image: 'repo/app:1.0.0',
              Labels: { 'dd.hook.pre': 'echo pre', 'dd.hook.timeout': '5000', 'dd.watch': 'true' },
            },
          },
          undefined,
          log,
        ),
      ).toEqual({ sourceImageLabels: undefined });

      expect(log.warn).toHaveBeenCalledTimes(1);
      const warning = log.warn.mock.calls[0][0];
      expect(warning).toContain('container app');
      expect(warning).toContain('sha256:image-gone');
      expect(warning).toContain('dd.hook.pre, dd.hook.timeout');
      expect(warning).not.toContain('dd.watch');
    });

    test('getHookLabelProvenance reports unknown provenance when the container spec carries no image ID or name', () => {
      const manager = createManager();
      const log = createHookLog();

      expect(
        manager.getHookLabelProvenance(
          { Config: { Image: 'repo/app:1.0.0', Labels: { 'dd.hook.pre': 'echo pre' } } },
          undefined,
          log,
        ),
      ).toEqual({ sourceImageLabels: undefined });

      const warning = log.warn.mock.calls[0][0];
      expect(warning).toContain('container unknown');
      expect(warning).toContain('image unknown');
    });

    test('getHookLabelProvenance still reports unknown provenance when the logger has no warn method', () => {
      const manager = createManager();

      expect(
        manager.getHookLabelProvenance(
          { Name: '/app', Image: 'sha256:image-gone', Config: { Labels: BAKED_HOOK } },
          undefined,
          undefined,
        ),
      ).toEqual({ sourceImageLabels: undefined });
    });

    test('sanitizeImageInheritedHookLabels drops hook labels the source image carries and keeps the operator ones', () => {
      const manager = createManager();
      const log = createHookLog();
      const labels = {
        'dd.watch': 'true',
        'dd.hook.pre': 'echo baked',
        'dd.hook.post': 'echo operator',
        'dd.hook.timeout': '5000',
        maintainer: 'publisher',
      };

      expect(
        manager.sanitizeImageInheritedHookLabels(
          labels,
          {
            sourceImageLabels: {
              'dd.hook.pre': 'echo baked',
              // Same key, different value: the operator overrode the image.
              'dd.hook.timeout': '9000',
              // Inherited, but not a hook label: left to sanitizeImageInheritedLabels.
              maintainer: 'publisher',
            },
          },
          log,
        ),
      ).toEqual({
        'dd.watch': 'true',
        'dd.hook.post': 'echo operator',
        'dd.hook.timeout': '5000',
        maintainer: 'publisher',
      });

      expect(log.info).toHaveBeenCalledTimes(1);
      expect(log.info).toHaveBeenCalledWith(
        'Dropping hook label dd.hook.pre from cloned container spec: it comes from the image the container was created from, not from the container',
      );
    });

    test('sanitizeImageInheritedHookLabels drops every hook label when provenance is unknown', () => {
      const manager = createManager();
      const log = createHookLog();

      expect(
        manager.sanitizeImageInheritedHookLabels(
          {
            'dd.watch': 'true',
            'dd.hook.pre': 'echo pre',
            'dd.hook.pre.abort': 'false',
            maintainer: 'publisher',
          },
          { sourceImageLabels: undefined },
          log,
        ),
      ).toEqual({ 'dd.watch': 'true', maintainer: 'publisher' });

      expect(log.info).toHaveBeenCalledTimes(2);
      expect(log.info).toHaveBeenCalledWith(
        'Dropping hook label dd.hook.pre from cloned container spec: the image the container was created from could not be inspected, so the label cannot be told apart from an image-baked one',
      );
      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining('Dropping hook label dd.hook.pre.abort from cloned container spec'),
      );
    });

    test('sanitizeImageInheritedHookLabels returns the same labels when there is nothing to drop', () => {
      const manager = createManager();
      const labels = { 'dd.watch': 'true', 'dd.hook.pre': 'echo operator' };

      // No hook label on the container: provenance was never looked up.
      expect(manager.sanitizeImageInheritedHookLabels(labels, undefined, createHookLog())).toBe(
        labels,
      );
      expect(
        manager.sanitizeImageInheritedHookLabels(
          undefined,
          { sourceImageLabels: BAKED_HOOK },
          createHookLog(),
        ),
      ).toBeUndefined();
      expect(
        manager.sanitizeImageInheritedHookLabels(labels, { sourceImageLabels: {} }, undefined),
      ).toBe(labels);
      expect(
        manager.sanitizeImageInheritedHookLabels(
          labels,
          { sourceImageLabels: BAKED_HOOK },
          createHookLog(),
        ),
      ).toBe(labels);
    });

    test('sanitizeClonedRuntimeConfig drops an inherited hook label when the tag-resolved source image is already the target image', () => {
      const manager = createManager();
      const log = createHookLog();
      // A spec with no image ID after a same-tag pull: Config.Image stands in
      // for the source and already resolves to the new image, so the label
      // comparison sees source === target.
      const movedTagImageConfig = { Labels: { maintainer: 'publisher' } };

      const result = manager.sanitizeClonedRuntimeConfig(
        {
          Image: 'repo/app:latest',
          Labels: { ...BAKED_HOOK, 'dd.watch': 'true', maintainer: 'publisher' },
        },
        movedTagImageConfig,
        movedTagImageConfig,
        {},
        log,
        { sourceImageLabels: BAKED_HOOK },
      );

      expect(result.Labels).toEqual({ 'dd.watch': 'true', maintainer: 'publisher' });
    });

    test('sanitizeClonedRuntimeConfig removes Labels entirely when only inherited hook labels were set', () => {
      const manager = createManager();

      const result = manager.sanitizeClonedRuntimeConfig(
        { Labels: { ...BAKED_HOOK } },
        undefined,
        undefined,
        {},
        createHookLog(),
        { sourceImageLabels: BAKED_HOOK },
      );

      expect(result).toEqual({});
    });

    test('getCloneRuntimeConfigOptions resolves hook label provenance and the runtime defaults by image ID', async () => {
      const manager = createManager();
      const log = createHookLog();
      const dockerApi = createImageApi({
        'repo/app:latest': { Config: { Entrypoint: ['/new-entry'] } },
        'repo/app:latest@sha256:b': { Config: { Entrypoint: ['/new-entry'] } },
        'sha256:image-a': { Config: { Entrypoint: ['/old-entry'], Labels: BAKED_HOOK } },
      });

      const options = await manager.getCloneRuntimeConfigOptions(
        dockerApi,
        {
          Name: '/app',
          Image: 'sha256:image-a',
          Config: { Image: 'repo/app:latest', Labels: { ...BAKED_HOOK, 'dd.watch': 'true' } },
        },
        'repo/app:latest@sha256:b',
        log,
      );

      // The tag has moved to the new image. The image ID still names the old one.
      expect(options.sourceImageConfig).toEqual({ Entrypoint: ['/old-entry'], Labels: BAKED_HOOK });
      expect(options.targetImageConfig).toEqual({ Entrypoint: ['/new-entry'] });
      expect(options.hookLabelProvenance).toEqual({ sourceImageLabels: BAKED_HOOK });
      // One read of the old image serves both, and the tag is never consulted.
      expect(dockerApi.getImage.mock.calls.map(([imageRef]) => imageRef).sort()).toEqual([
        'repo/app:latest@sha256:b',
        'sha256:image-a',
      ]);
    });

    test('getCloneRuntimeConfigOptions reports unknown hook provenance when the image ID cannot be inspected', async () => {
      const manager = createManager();
      const log = createHookLog();
      // The image the container runs is gone; only tags resolve.
      const dockerApi = createImageApi({
        'repo/app:1.0.0': { Config: { Labels: BAKED_HOOK } },
        'repo/app:1.0.1@sha256:b': { Config: {} },
      });

      const options = await manager.getCloneRuntimeConfigOptions(
        dockerApi,
        {
          Name: '/app',
          Image: 'sha256:image-gone',
          Config: { Image: 'repo/app:1.0.0', Labels: { 'dd.hook.pre': 'echo pre' } },
        },
        'repo/app:1.0.1@sha256:b',
        log,
      );

      expect(options.sourceImageConfig).toBeUndefined();
      expect(options.hookLabelProvenance).toEqual({ sourceImageLabels: undefined });
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('sha256:image-gone'));
      expect(dockerApi.getImage.mock.calls.map(([imageRef]) => imageRef).sort()).toEqual([
        'repo/app:1.0.1@sha256:b',
        'sha256:image-gone',
      ]);
    });

    test('getCloneRuntimeConfigOptions never verifies hook labels against the Config.Image stand-in', async () => {
      const manager = createManager();
      const log = createHookLog();
      // No image ID on the spec, so Config.Image stands in for the runtime
      // defaults. It resolves to an image without the hook label, which would
      // make the container's label look like the operator's.
      const dockerApi = createImageApi({
        'repo/app:1.0.0': { Config: { Cmd: ['serve'] } },
        'repo/app:1.0.1@sha256:b': { Config: {} },
      });

      const options = await manager.getCloneRuntimeConfigOptions(
        dockerApi,
        { Config: { Image: 'repo/app:1.0.0', Labels: { 'dd.hook.pre': 'echo pre' } } },
        'repo/app:1.0.1@sha256:b',
        log,
      );

      expect(options.sourceImageConfig).toEqual({ Cmd: ['serve'] });
      expect(options.hookLabelProvenance).toEqual({ sourceImageLabels: undefined });
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('image unknown'));
    });

    test('getCloneRuntimeConfigOptions makes no hook provenance lookup when the container has no hook label', async () => {
      const manager = createManager();
      const dockerApi = createImageApi({
        'repo/app:latest': { Config: {} },
        'repo/app:latest@sha256:b': { Config: {} },
        'sha256:image-a': { Config: { Labels: BAKED_HOOK } },
      });

      const options = await manager.getCloneRuntimeConfigOptions(
        dockerApi,
        {
          Name: '/app',
          Image: 'sha256:image-a',
          Config: { Image: 'repo/app:latest', Labels: { 'dd.watch': 'true' } },
        },
        'repo/app:latest@sha256:b',
        createHookLog(),
      );

      expect(options.hookLabelProvenance).toBeUndefined();
      // One inspect for the source image, one for the target, none for hooks.
      expect(dockerApi.getImage.mock.calls.map(([imageRef]) => imageRef).sort()).toEqual([
        'repo/app:latest@sha256:b',
        'sha256:image-a',
      ]);
    });

    test('buildCloneRuntimeConfigOptions recognises an options object that only carries hook label provenance', () => {
      const manager = createManager();
      const options = { hookLabelProvenance: { sourceImageLabels: BAKED_HOOK } };

      expect(manager.buildCloneRuntimeConfigOptions(options)).toBe(options);
    });
  });

  describe('getDefaultRuntime', () => {
    test('returns the daemon DefaultRuntime reported by info()', async () => {
      const manager = createManager();
      const dockerApi = { info: vi.fn().mockResolvedValue({ DefaultRuntime: 'runc' }) };

      await expect(manager.getDefaultRuntime(dockerApi, createLog())).resolves.toBe('runc');
    });

    test('returns undefined when dockerApi exposes no info()', async () => {
      const manager = createManager();

      await expect(manager.getDefaultRuntime({}, createLog())).resolves.toBeUndefined();
      await expect(manager.getDefaultRuntime(undefined, createLog())).resolves.toBeUndefined();
    });

    test('returns undefined when dockerApi.info() resolves to a non-record value', async () => {
      // ContainerRuntimeConfigManager.ts line 543: `if (!isRecord(info)) { return undefined; }`
      const manager = createManager();

      await expect(
        manager.getDefaultRuntime({ info: vi.fn().mockResolvedValue(null) }, createLog()),
      ).resolves.toBeUndefined();
      await expect(
        manager.getDefaultRuntime({ info: vi.fn().mockResolvedValue('string-value') }, createLog()),
      ).resolves.toBeUndefined();
      await expect(
        manager.getDefaultRuntime({ info: vi.fn().mockResolvedValue(42) }, createLog()),
      ).resolves.toBeUndefined();
    });

    test('returns undefined when DefaultRuntime is absent or empty', async () => {
      const manager = createManager();

      await expect(
        manager.getDefaultRuntime({ info: vi.fn().mockResolvedValue({}) }, createLog()),
      ).resolves.toBeUndefined();
      await expect(
        manager.getDefaultRuntime(
          { info: vi.fn().mockResolvedValue({ DefaultRuntime: '' }) },
          createLog(),
        ),
      ).resolves.toBeUndefined();
    });

    test('returns undefined and logs a debug line when info() rejects', async () => {
      const manager = createManager();
      const log = createLog();
      const dockerApi = { info: vi.fn().mockRejectedValue(new Error('daemon unreachable')) };

      await expect(manager.getDefaultRuntime(dockerApi, log)).resolves.toBeUndefined();
      expect(log.debug).toHaveBeenCalledWith(
        expect.stringContaining('Unable to read daemon DefaultRuntime'),
      );
    });

    test('returns undefined and logs the raw value when info() rejects with a non-Error (?? e fallback)', async () => {
      const manager = createManager();
      const log = createLog();
      const dockerApi = { info: vi.fn().mockRejectedValue('raw daemon failure') };

      await expect(manager.getDefaultRuntime(dockerApi, log)).resolves.toBeUndefined();
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('raw daemon failure'));
    });
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

  test('vaultwarden scenario: UNKNOWN origin + stale entrypoint matches old image + new image has no entrypoint → drop stale value', () => {
    // Reproduces vaultwarden 1.27.0 → 1.35.8:
    //   - Old image: Entrypoint=['/usr/bin/entry.sh'], new image: Entrypoint=null
    //   - Container was never updated by drydock (no origin label set → UNKNOWN)
    //   - Container's Entrypoint matches old image exactly (came from image default, not user override)
    //   - Expected: stale Entrypoint is dropped so new image default (null) applies
    const manager = createManager();
    const log = createLog();

    const result = manager.sanitizeClonedRuntimeConfig(
      {
        Entrypoint: ['/usr/bin/entry.sh'],
        Cmd: ['/start.sh'],
      },
      {
        Entrypoint: ['/usr/bin/entry.sh'],
        Cmd: ['/start.sh'],
      },
      {
        Entrypoint: undefined,
        Cmd: ['/start.sh'],
      },
      {
        Entrypoint: 'unknown',
        Cmd: 'unknown',
      },
      log,
    );

    expect(result).not.toHaveProperty('Entrypoint');
    expect(result).toHaveProperty('Cmd', ['/start.sh']);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Dropping stale Entrypoint'));
  });
});
