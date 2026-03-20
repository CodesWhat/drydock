import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import yaml from 'yaml';
import { getState } from '../../../registry/index.js';
import Dockercompose, {
  testable_hasExplicitRegistryHost,
  testable_normalizeImplicitLatest,
  testable_normalizePostStartEnvironmentValue,
  testable_normalizePostStartHooks,
  testable_updateComposeServiceImageInText,
} from './Dockercompose.js';
import { setupDockercomposeTestContext } from './Dockercompose.test.helpers.js';

vi.mock('../../../registry', () => ({
  getState: vi.fn(),
}));

vi.mock('../../../event/index.js', () => ({
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
  emitSelfUpdateStarting: vi.fn(),
}));

vi.mock('../../../model/container.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fullName: vi.fn((c) => `test_${c.name}`),
  };
});

vi.mock('../../../store/backup', () => ({
  insertBackup: vi.fn(),
  pruneOldBackups: vi.fn(),
  getBackupsByName: vi.fn().mockReturnValue([]),
}));

// Modules used by the shared lifecycle (inherited from Docker trigger)
vi.mock('../../../configuration/index.js', async () => {
  const actual = await vi.importActual('../../../configuration/index.js');
  return { ...actual, getSecurityConfiguration: vi.fn().mockReturnValue({ enabled: false }) };
});
vi.mock('../../../store/audit.js', () => ({ insertAudit: vi.fn() }));
vi.mock('../../../prometheus/audit.js', () => ({ getAuditCounter: vi.fn().mockReturnValue(null) }));
vi.mock('../../../security/scan.js', () => ({
  scanImageForVulnerabilities: vi.fn(),
  verifyImageSignature: vi.fn(),
  generateImageSbom: vi.fn(),
  clearDigestScanCache: vi.fn(),
  getDigestScanCacheSize: vi.fn().mockReturnValue(0),
  updateDigestScanCache: vi.fn(),
  scanImageWithDedup: vi.fn(),
}));
vi.mock('../../../store/container.js', () => ({
  getContainer: vi.fn(),
  updateContainer: vi.fn(),
  cacheSecurityState: vi.fn(),
}));
vi.mock('../../hooks/HookRunner.js', () => ({ runHook: vi.fn() }));
vi.mock('../docker/HealthMonitor.js', () => ({ startHealthMonitor: vi.fn() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    watch: vi.fn(),
  };
});

vi.mock('../../../util/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      access: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from('')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    },
    access: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  };
});

describe('Dockercompose Trigger', () => {
  let trigger;
  let mockLog;
  let mockDockerApi;

  beforeEach(() => {
    ({ trigger, mockLog, mockDockerApi } = setupDockercomposeTestContext({
      DockercomposeCtor: Dockercompose,
      watchMock: watch,
      getStateMock: getState,
    }));
  });

  // getComposeFileForContainer
  // -----------------------------------------------------------------------

  test('getComposeFileForContainer should use label from container', () => {
    const container = {
      labels: { 'dd.compose.file': '/opt/compose.yml' },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBe('/opt/compose.yml');
  });

  test('getComposeFileForContainer should use wud fallback label', () => {
    const container = {
      labels: { 'wud.compose.file': '/opt/wud-compose.yml' },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBe('/opt/wud-compose.yml');
  });

  test('getComposeFileForContainer should use the first compose config file from compose labels', () => {
    const container = {
      labels: {
        'com.docker.compose.project.config_files':
          '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
      },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBe('/opt/drydock/test/stack.yml');
  });

  test('getComposeFileForContainer should resolve relative label paths', () => {
    const container = {
      labels: { 'dd.compose.file': 'relative/compose.yml' },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toMatch(/\/.*relative\/compose\.yml$/);
    expect(result).not.toBe('relative/compose.yml');
  });

  test('getComposeFileForContainer should return null when no label and no default file', () => {
    trigger.configuration.file = undefined;
    const container = { labels: {} };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBeNull();
  });

  test('getComposeFileForContainer should fall back to default config file', () => {
    trigger.configuration.file = '/default/compose.yml';
    const container = { labels: {} };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBe('/default/compose.yml');
  });

  test('getComposeFileForContainer should return null and warn when label value is invalid', () => {
    const container = {
      name: 'broken',
      labels: { 'dd.compose.file': '\0bad' },
    };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('is invalid'));
  });

  test('getComposeFileForContainer should return null and warn when default path is invalid', () => {
    trigger.configuration.file = '\0broken';
    const container = { labels: {} };

    const result = trigger.getComposeFileForContainer(container);

    expect(result).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Default compose file path is invalid'),
    );
  });

  test('getComposeFilesForContainer should prefer legacy label over compose project labels', () => {
    const container = {
      name: 'with-both-labels',
      labels: {
        'dd.compose.file': '/opt/drydock/test/legacy.yml',
        'com.docker.compose.project.config_files':
          '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
      },
    };

    const result = trigger.getComposeFilesForContainer(container);

    expect(result).toEqual(['/opt/drydock/test/legacy.yml']);
  });

  test('getWritableComposeFileForService should throw when compose file chain is empty', async () => {
    await expect(trigger.getWritableComposeFileForService([], 'nginx')).rejects.toThrow(
      'Cannot resolve writable compose file for service nginx because compose file chain is empty',
    );
    expect(fs.access).not.toHaveBeenCalled();
  });

  test('triggerBatch should fallback to inspect labels for compose config files when cached labels do not include them', async () => {
    fs.access.mockResolvedValue(undefined);
    mockDockerApi.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Config: {
          Labels: {
            'com.docker.compose.project.config_files':
              '/opt/drydock/test/stack.yml,/opt/drydock/test/stack.override.yml',
          },
        },
      }),
    });
    const container = { name: 'inspected', watcher: 'local', labels: {} };
    const processComposeFileSpy = vi.spyOn(trigger, 'processComposeFile').mockResolvedValue();

    await trigger.triggerBatch([container]);

    expect(processComposeFileSpy).toHaveBeenCalledWith(
      '/opt/drydock/test/stack.yml',
      [container],
      ['/opt/drydock/test/stack.yml', '/opt/drydock/test/stack.override.yml'],
    );
  });

  // -----------------------------------------------------------------------
  // initTrigger & trigger delegation
  // -----------------------------------------------------------------------

  test('initTrigger should set mode to batch', async () => {
    trigger.configuration.mode = 'simple';
    trigger.configuration.file = undefined;

    await trigger.initTrigger();

    expect(trigger.configuration.mode).toBe('batch');
  });

  test('initTrigger should throw when configured file does not exist', async () => {
    trigger.configuration.file = '/nonexistent/compose.yml';
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    fs.access.mockRejectedValueOnce(err);

    await expect(trigger.initTrigger()).rejects.toThrow('ENOENT');

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
  });

  test('initTrigger should log permission denied when configured file has EACCES', async () => {
    trigger.configuration.file = '/restricted/compose.yml';
    const err = new Error('EACCES');
    err.code = 'EACCES';
    fs.access.mockRejectedValueOnce(err);

    await expect(trigger.initTrigger()).rejects.toThrow('EACCES');

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  });

  test('trigger should delegate to triggerBatch with single container', async () => {
    const container = { name: 'test' };
    const spy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue([true]);

    await trigger.trigger(container);

    expect(spy).toHaveBeenCalledWith([container]);
  });

  test('trigger should throw when update is still available but compose trigger applies no runtime updates', async () => {
    trigger.configuration.dryrun = false;
    const container = { name: 'test', updateAvailable: true };
    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue([false]);

    await expect(trigger.trigger(container)).rejects.toThrow(
      'No compose updates were applied for container test',
    );
  });

  test('trigger should use unknown fallback when throwing without a container name', async () => {
    trigger.configuration.dryrun = false;
    const container = { updateAvailable: true };
    vi.spyOn(trigger, 'triggerBatch').mockResolvedValue([false]);

    await expect(trigger.trigger(container as any)).rejects.toThrow(
      'No compose updates were applied for container unknown',
    );
  });

  test('getConfigurationSchema should extend Docker schema with compose hardening options', () => {
    const schema = trigger.getConfigurationSchema();
    expect(schema).toBeDefined();
    const { error } = schema.validate({
      prune: false,
      dryrun: false,
      autoremovetimeout: 10000,
      file: '/opt/drydock/test/compose.yml',
      backup: true,
      composeFileLabel: 'dd.compose.file',
      reconciliationMode: 'block',
      digestPinning: true,
      composeFileOnce: true,
    });
    expect(error).toBeUndefined();
  });

  test('getConfigurationSchema should accept env-normalized compose hardening keys', () => {
    const schema = trigger.getConfigurationSchema();
    const { error, value } = schema.validate({
      prune: false,
      dryrun: false,
      autoremovetimeout: 10000,
      file: '/opt/drydock/test/compose.yml',
      backup: true,
      composefilelabel: 'com.example.compose.file',
      reconciliationmode: 'block',
      digestpinning: true,
      composefileonce: true,
    });
    expect(error).toBeUndefined();
    expect(value.composeFileLabel).toBe('com.example.compose.file');
    expect(value.reconciliationMode).toBe('block');
    expect(value.digestPinning).toBe(true);
    expect(value.composeFileOnce).toBe(true);
  });

  test('normalizeImplicitLatest should return input when image is empty or already digest/tag qualified', () => {
    expect(testable_normalizeImplicitLatest('')).toBe('');
    expect(testable_normalizeImplicitLatest('alpine@sha256:abc')).toBe('alpine@sha256:abc');
    expect(testable_normalizeImplicitLatest('nginx:1.0.0')).toBe('nginx:1.0.0');
  });

  test('normalizeImplicitLatest should append latest even when image path ends with slash', () => {
    expect(testable_normalizeImplicitLatest('repo/')).toBe('repo/:latest');
  });

  test('hasExplicitRegistryHost should detect empty, host:port, and localhost prefixes', () => {
    expect(testable_hasExplicitRegistryHost('')).toBe(false);
    expect(testable_hasExplicitRegistryHost('registry.example.com:5000/nginx:1.1.0')).toBe(true);
    expect(testable_hasExplicitRegistryHost('localhost/nginx:1.1.0')).toBe(true);
  });

  test('normalizePostStartHooks should return empty array when post_start is missing', () => {
    expect(testable_normalizePostStartHooks(undefined)).toEqual([]);
  });

  test('normalizePostStartEnvironmentValue should return empty string on json serialization errors', () => {
    const circular: any = {};
    circular.self = circular;
    expect(testable_normalizePostStartEnvironmentValue(circular)).toBe('');
  });

  test('updateComposeServiceImageInText should update only target service image while preserving comments', () => {
    const compose = [
      'services:',
      '  nginx:',
      '    # pinned for compatibility',
      '    image: nginx:1.1.0 # current',
      '    environment:',
      '      - NGINX_PORT=80',
      '  redis:',
      '    image: redis:7.0.0',
      '',
    ].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('    # pinned for compatibility');
    expect(updated).toContain('    image: nginx:1.2.0 # current');
    expect(updated).toContain('  redis:');
    expect(updated).toContain('    image: redis:7.0.0');
  });

  test('updateComposeServiceImageInText should insert image when service has no image key', () => {
    const compose = ['services:', '  nginx:', '    environment:', '      - NGINX_PORT=80', ''].join(
      '\n',
    );

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('  nginx:');
    expect(updated).toContain('    image: nginx:1.2.0');
    expect(updated).toContain('    environment:');
  });

  test('updateComposeServiceImageInText should preserve CRLF newlines', () => {
    const compose = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\r\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('\r\n');
    expect(updated).toContain('image: nginx:1.2.0');
  });

  test('updateComposeServiceImageInText should preserve quote style when replacing image value', () => {
    const compose = ['services:', '  nginx:', "    image: 'nginx:1.1.0'", ''].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain("image: 'nginx:1.2.0'");
  });

  test('updateComposeServiceImageInText should update image in flow-style service mapping', () => {
    const compose = ['services:', '  nginx: { image: "nginx:1.1.0", restart: always }', ''].join(
      '\n',
    );

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('nginx: { image: "nginx:1.2.0", restart: always }');
  });

  test('updateComposeServiceImageInText should parse with maxAliasCount guard', () => {
    const compose = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');
    const parseDocumentSpy = vi.spyOn(yaml, 'parseDocument');

    testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(parseDocumentSpy).toHaveBeenCalledWith(
      compose,
      expect.objectContaining({
        keepSourceTokens: true,
        maxAliasCount: 10000,
      }),
    );
  });

  test('updateComposeServiceImageInText should throw for flow-style services without image key', () => {
    const compose = ['services:', '  nginx: { restart: always }', ''].join('\n');

    expect(() => testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0')).toThrow(
      'Unable to insert compose image for flow-style service nginx without image key',
    );
  });

  test('updateComposeServiceImageInText should throw when services section is missing', () => {
    const compose = ['version: "3"', 'x-service: value', ''].join('\n');

    expect(() => testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0')).toThrow(
      'Unable to locate services section in compose file',
    );
  });

  test('updateComposeServiceImageInText should insert image using default field indentation when service has no fields', () => {
    const compose = ['services:', '  nginx:', ''].join('\n');

    const updated = testable_updateComposeServiceImageInText(compose, 'nginx', 'nginx:1.2.0');

    expect(updated).toContain('  nginx:');
    expect(updated).toContain('    image: nginx:1.2.0');
  });

  test('updateComposeServiceImageInText should throw when service is missing', () => {
    const compose = ['services:', '  nginx:', '    image: nginx:1.1.0', ''].join('\n');

    expect(() => testable_updateComposeServiceImageInText(compose, 'redis', 'redis:7.1.0')).toThrow(
      'Unable to locate compose service redis',
    );
  });

  // -----------------------------------------------------------------------
});
