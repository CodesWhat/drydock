import { expect, test, vi } from 'vitest';
import ContainerRuntimeConfigManager from './ContainerRuntimeConfigManager.js';
import HookExecutor from './HookExecutor.js';
import RegistryResolver from './RegistryResolver.js';
import SecurityGate from './SecurityGate.js';

function createMockLog(...methods) {
  const mockLog = {};
  for (const method of methods) {
    mockLog[method] = vi.fn();
  }
  return mockLog;
}

test('RegistryResolver should resolve a compatible registry manager by name', () => {
  const resolver = new RegistryResolver();
  const registryManager = {
    getAuthPull: vi.fn(),
    getImageFullName: vi.fn(),
    normalizeImage: vi.fn(),
  };

  const resolved = resolver.resolveRegistryManager(
    {
      image: {
        registry: {
          name: 'hub',
        },
      },
    },
    createMockLog('debug'),
    { hub: registryManager },
    {
      requireNormalizeImage: true,
    },
  );

  expect(resolved).toBe(registryManager);
});

test('ContainerRuntimeConfigManager should detect runtime compatibility errors', () => {
  const manager = new ContainerRuntimeConfigManager({
    getPreferredLabelValue: vi.fn(),
    getLogger: () => createMockLog('warn'),
  });

  expect(
    manager.isRuntimeConfigCompatibilityError(
      'OCI runtime create failed: exec: "/docker-entrypoint.sh": no such file or directory',
    ),
  ).toBe(true);
  expect(manager.isRuntimeConfigCompatibilityError('network timeout')).toBe(false);
});

test('HookExecutor should run pre-update hooks and record success audit', async () => {
  const runHook = vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: 'done',
    stderr: '',
    timedOut: false,
  });
  const recordHookAudit = vi.fn();
  const executor = new HookExecutor({
    runHook,
    getPreferredLabelValue: vi.fn(),
    getLogger: () => ({ child: () => ({}) }),
    recordHookAudit,
  });

  const container = {
    name: 'web',
    id: 'container-id',
    image: { name: 'nginx', tag: { value: '1.0.0' } },
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '1.0.1',
    },
    labels: {},
  };

  await executor.runPreUpdateHook(
    container,
    {
      hookPre: 'echo pre',
      hookPreAbort: true,
      hookTimeout: 1000,
      hookEnv: {},
    },
    createMockLog('warn'),
  );

  expect(runHook).toHaveBeenCalledWith('echo pre', {
    timeout: 1000,
    env: {},
    label: 'pre-update',
  });
  expect(recordHookAudit).toHaveBeenCalledWith(
    'hook-pre-success',
    container,
    'success',
    'Pre-update hook completed: done',
  );
});

test('SecurityGate should no-op when security scanning is disabled', async () => {
  const scanImageForVulnerabilities = vi.fn();
  const gate = new SecurityGate({
    securityConfig: {
      getSecurityConfiguration: () => ({ enabled: false, scanner: 'trivy' }),
    },
    scanners: {
      verifyImageSignature: vi.fn(),
      scanImageForVulnerabilities,
      generateImageSbom: vi.fn(),
    },
    stateStore: {
      getContainer: vi.fn(),
      updateContainer: vi.fn(),
      cacheSecurityState: vi.fn(),
    },
    telemetry: {
      emitSecurityAlert: vi.fn(),
      fullName: vi.fn((container) => container.name),
      recordSecurityAudit: vi.fn(),
    },
  });

  await gate.maybeScanAndGateUpdate(
    {
      newImage: 'nginx:1.0.1',
      auth: undefined,
    },
    {
      id: 'container-id',
      watcher: 'test',
      name: 'web',
      image: { name: 'nginx', tag: { value: '1.0.0' } },
    },
    createMockLog('info', 'warn'),
  );

  expect(scanImageForVulnerabilities).not.toHaveBeenCalled();
});
