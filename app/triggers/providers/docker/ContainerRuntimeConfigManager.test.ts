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

  describe('hook label provenance on recreate', () => {
    const BAKED_HOOK = { 'dd.hook.pre': 'echo baked' };

    function createHookLog() {
      return { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };
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

    test('getHookLabelProvenance reads the image the container was created from by image ID, not by tag', async () => {
      const manager = createManager();
      const log = createHookLog();
      const dockerApi = createImageApi({
        // The tag has already moved to an image that bakes no hook label.
        'repo/app:latest': { Config: {} },
        'sha256:image-a': { Config: { Labels: { ...BAKED_HOOK, maintainer: 'publisher' } } },
      });

      await expect(
        manager.getHookLabelProvenance(
          dockerApi,
          {
            Name: '/app',
            Image: 'sha256:image-a',
            Config: { Image: 'repo/app:latest', Labels: { ...BAKED_HOOK, 'dd.watch': 'true' } },
          },
          log,
        ),
      ).resolves.toEqual({ sourceImageLabels: { ...BAKED_HOOK, maintainer: 'publisher' } });

      expect(dockerApi.getImage).toHaveBeenCalledTimes(1);
      expect(dockerApi.getImage).toHaveBeenCalledWith('sha256:image-a');
      expect(log.warn).not.toHaveBeenCalled();
    });

    test.each([
      ['an image config without a Labels key', { Config: {} }],
      ['an image config with null Labels', { Config: { Labels: null } }],
    ])(
      'getHookLabelProvenance treats %s as an image that bakes no labels',
      async (_name, image) => {
        const manager = createManager();
        const dockerApi = createImageApi({ 'sha256:image-b': image });

        await expect(
          manager.getHookLabelProvenance(
            dockerApi,
            {
              Name: '/app',
              Image: 'sha256:image-b',
              Config: { Labels: { 'dd.hook.post': 'echo op' } },
            },
            createHookLog(),
          ),
        ).resolves.toEqual({ sourceImageLabels: {} });
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
    ])('getHookLabelProvenance inspects no image for a container with %s', async (_name, spec) => {
      const manager = createManager();
      const dockerApi = createImageApi({ 'sha256:image-a': { Config: { Labels: BAKED_HOOK } } });

      await expect(
        manager.getHookLabelProvenance(dockerApi, spec, createHookLog()),
      ).resolves.toBeUndefined();

      expect(dockerApi.getImage).not.toHaveBeenCalled();
    });

    test('getHookLabelProvenance reports unknown provenance and warns when the image cannot be inspected by ID', async () => {
      const manager = createManager();
      const log = createHookLog();
      // Only the tag resolves; the image the container runs is gone.
      const dockerApi = createImageApi({ 'repo/app:1.0.0': { Config: { Labels: BAKED_HOOK } } });

      await expect(
        manager.getHookLabelProvenance(
          dockerApi,
          {
            Name: '/app',
            Image: 'sha256:image-gone',
            Config: {
              Image: 'repo/app:1.0.0',
              Labels: { 'dd.hook.pre': 'echo pre', 'dd.hook.timeout': '5000', 'dd.watch': 'true' },
            },
          },
          log,
        ),
      ).resolves.toEqual({ sourceImageLabels: undefined });

      expect(dockerApi.getImage).toHaveBeenCalledTimes(1);
      expect(dockerApi.getImage).toHaveBeenCalledWith('sha256:image-gone');
      expect(log.warn).toHaveBeenCalledTimes(1);
      const warning = log.warn.mock.calls[0][0];
      expect(warning).toContain('container app');
      expect(warning).toContain('sha256:image-gone');
      expect(warning).toContain('dd.hook.pre, dd.hook.timeout');
      expect(warning).not.toContain('dd.watch');
    });

    test('getHookLabelProvenance reports unknown provenance when the container spec carries no image ID or name', async () => {
      const manager = createManager();
      const log = createHookLog();
      const dockerApi = createImageApi({ 'repo/app:1.0.0': { Config: { Labels: {} } } });

      await expect(
        manager.getHookLabelProvenance(
          dockerApi,
          { Config: { Image: 'repo/app:1.0.0', Labels: { 'dd.hook.pre': 'echo pre' } } },
          log,
        ),
      ).resolves.toEqual({ sourceImageLabels: undefined });

      // The tag is never used as a stand-in for the missing image ID.
      expect(dockerApi.getImage).not.toHaveBeenCalled();
      const warning = log.warn.mock.calls[0][0];
      expect(warning).toContain('container unknown');
      expect(warning).toContain('image unknown');
    });

    test('getHookLabelProvenance still reports unknown provenance when the logger has no warn method', async () => {
      const manager = createManager();

      await expect(
        manager.getHookLabelProvenance(
          createImageApi({}),
          { Name: '/app', Image: 'sha256:image-gone', Config: { Labels: BAKED_HOOK } },
          undefined,
        ),
      ).resolves.toEqual({ sourceImageLabels: undefined });
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
              // Inherited, but not a hook label: left to the tag-based sanitizer.
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
      // Same-tag update: after the pull `repo/app:latest` resolves to the new
      // image, so the tag-based comparison sees source === target.
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

    test('getCloneRuntimeConfigOptions resolves hook label provenance by image ID and leaves the runtime defaults on the tag', async () => {
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

      // Unchanged: Entrypoint/Cmd/Env sanitisation keeps resolving the source by tag.
      expect(options.sourceImageConfig).toEqual({ Entrypoint: ['/new-entry'] });
      expect(options.targetImageConfig).toEqual({ Entrypoint: ['/new-entry'] });
      expect(options.hookLabelProvenance).toEqual({ sourceImageLabels: BAKED_HOOK });
      expect(dockerApi.getImage.mock.calls.map(([imageRef]) => imageRef).sort()).toEqual([
        'repo/app:latest',
        'repo/app:latest@sha256:b',
        'sha256:image-a',
      ]);
    });

    test('getCloneRuntimeConfigOptions makes no extra image inspect when the container has no hook label', async () => {
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
      expect(dockerApi.getImage).toHaveBeenCalledTimes(2);
      expect(dockerApi.getImage).not.toHaveBeenCalledWith('sha256:image-a');
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
