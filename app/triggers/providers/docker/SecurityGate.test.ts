import { describe, expect, test, vi } from 'vitest';
import SecurityGate from './SecurityGate.js';

function createContainer(overrides = {}) {
  return {
    id: 'container-id',
    watcher: 'docker.local',
    name: 'web',
    security: {
      existing: true,
    },
    ...overrides,
  };
}

function createLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function createGateHarness(overrides = {}) {
  const securityConfiguration = {
    enabled: true,
    scanner: 'trivy',
    signature: {
      verify: false,
    },
    sbom: {
      enabled: false,
      formats: ['spdx-json'],
    },
    ...(overrides.securityConfiguration || {}),
  };

  const verifyImageSignature = vi.fn().mockResolvedValue({
    status: 'verified',
    signatures: 1,
  });
  const scanImageForVulnerabilities = vi.fn().mockResolvedValue({
    status: 'passed',
    summary: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    },
    blockingCount: 0,
    blockSeverities: [],
  });
  const generateImageSbom = vi.fn().mockResolvedValue({
    status: 'generated',
    formats: ['spdx-json'],
  });
  const emitSecurityAlert = vi.fn().mockResolvedValue(undefined);
  const getContainer = vi.fn((containerId) =>
    containerId === 'container-id'
      ? {
          id: 'container-id',
          watcher: 'docker.local',
          name: 'web',
          security: {
            persisted: true,
          },
        }
      : undefined,
  );
  const updateContainer = vi.fn();
  const cacheSecurityState = vi.fn();
  const fullName = vi.fn((container) => `${container.watcher}/${container.name}`);
  const recordSecurityAudit = vi.fn();

  const gate = new SecurityGate({
    getSecurityConfiguration: vi.fn(() => securityConfiguration),
    verifyImageSignature,
    scanImageForVulnerabilities,
    generateImageSbom,
    emitSecurityAlert,
    getContainer,
    updateContainer,
    cacheSecurityState,
    fullName,
    recordSecurityAudit,
    ...overrides,
  });

  return {
    gate,
    securityConfiguration,
    verifyImageSignature,
    scanImageForVulnerabilities,
    generateImageSbom,
    emitSecurityAlert,
    getContainer,
    updateContainer,
    cacheSecurityState,
    fullName,
    recordSecurityAudit,
  };
}

function createContext(overrides = {}) {
  return {
    newImage: 'ghcr.io/acme/web:2.0.0',
    auth: {
      username: 'bot',
      password: 'token',
    },
    ...overrides,
  };
}

describe('SecurityGate', () => {
  test('recordSecurityFailure should ignore unknown error codes', () => {
    const recordSecurityAudit = vi.fn();
    const gate = new SecurityGate({
      getSecurityConfiguration: vi.fn(() => ({
        enabled: false,
        scanner: 'trivy',
      })),
      verifyImageSignature: vi.fn(),
      scanImageForVulnerabilities: vi.fn(),
      generateImageSbom: vi.fn(),
      emitSecurityAlert: vi.fn(),
      getContainer: vi.fn(),
      updateContainer: vi.fn(),
      cacheSecurityState: vi.fn(),
      fullName: vi.fn(),
      recordSecurityAudit,
    });

    gate.recordSecurityFailure(createContainer(), {
      code: 'unknown-security-code',
      message: 'ignored',
    });

    expect(recordSecurityAudit).not.toHaveBeenCalled();
  });

  test('constructor should default recordSecurityAudit when omitted', async () => {
    const gate = new SecurityGate({
      getSecurityConfiguration: vi.fn(() => ({
        enabled: false,
        scanner: 'trivy',
      })),
      verifyImageSignature: vi.fn(),
      scanImageForVulnerabilities: vi.fn(),
      generateImageSbom: vi.fn(),
      emitSecurityAlert: vi.fn(),
      getContainer: vi.fn(),
      updateContainer: vi.fn(),
      cacheSecurityState: vi.fn(),
      fullName: vi.fn(),
    });

    await expect(
      gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).resolves.toBeUndefined();
  });

  test('default recordSecurityAudit should be callable during a successful scan', async () => {
    const scanImageForVulnerabilities = vi.fn().mockResolvedValue({
      status: 'passed',
      summary: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        unknown: 0,
      },
      blockingCount: 0,
      blockSeverities: [],
    });
    const gate = new SecurityGate({
      getSecurityConfiguration: vi.fn(() => ({
        enabled: true,
        scanner: 'trivy',
        signature: {
          verify: false,
        },
        sbom: {
          enabled: false,
          formats: ['spdx-json'],
        },
      })),
      verifyImageSignature: vi.fn(),
      scanImageForVulnerabilities,
      generateImageSbom: vi.fn(),
      emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
      getContainer: vi.fn(() => createContainer()),
      updateContainer: vi.fn(),
      cacheSecurityState: vi.fn(),
      fullName: vi.fn(() => 'docker.local/web'),
    });

    await gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog());
    expect(scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
  });

  test('persistSecurityState should merge and cache security state from current container', async () => {
    const { gate, updateContainer, cacheSecurityState } = createGateHarness();
    const log = createLog();

    await gate.persistSecurityState(
      createContainer(),
      {
        scan: {
          status: 'passed',
        },
      },
      log,
    );

    expect(updateContainer).toHaveBeenCalledWith({
      id: 'container-id',
      watcher: 'docker.local',
      name: 'web',
      security: {
        persisted: true,
        scan: {
          status: 'passed',
        },
      },
    });
    expect(cacheSecurityState).toHaveBeenCalledWith('docker.local', 'web', {
      persisted: true,
      scan: {
        status: 'passed',
      },
    });
  });

  test('persistSecurityState should warn and continue when persistence fails', async () => {
    const updateContainer = vi.fn(() => {
      throw new Error('db unavailable');
    });
    const { gate } = createGateHarness({
      updateContainer,
    });
    const log = createLog();

    await expect(
      gate.persistSecurityState(
        createContainer(),
        {
          scan: {
            status: 'error',
          },
        },
        log,
      ),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith('Unable to persist security state (db unavailable)');
  });

  test('persistSecurityState should extract message from unknown thrown values', async () => {
    const updateContainer = vi.fn(() => {
      throw 'db unavailable';
    });
    const { gate } = createGateHarness({
      updateContainer,
    });
    const log = createLog();

    await expect(
      gate.persistSecurityState(
        createContainer(),
        {
          scan: {
            status: 'error',
          },
        },
        log,
      ),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith('Unable to persist security state (db unavailable)');
  });

  test('persistSecurityState should fallback to incoming container when current container is unavailable', async () => {
    const updateContainer = vi.fn();
    const cacheSecurityState = vi.fn();
    const gate = new SecurityGate({
      getSecurityConfiguration: vi.fn(() => ({
        enabled: false,
        scanner: 'trivy',
      })),
      verifyImageSignature: vi.fn(),
      scanImageForVulnerabilities: vi.fn(),
      generateImageSbom: vi.fn(),
      emitSecurityAlert: vi.fn(),
      getContainer: vi.fn(() => undefined),
      updateContainer,
      cacheSecurityState,
      fullName: vi.fn(),
      recordSecurityAudit: vi.fn(),
    });

    await gate.persistSecurityState(
      {
        id: 'container-id',
        watcher: 'docker.local',
        name: 'web',
      },
      {
        signature: {
          status: 'verified',
        },
      },
      createLog(),
    );

    expect(updateContainer).toHaveBeenCalledWith({
      id: 'container-id',
      watcher: 'docker.local',
      name: 'web',
      security: {
        signature: {
          status: 'verified',
        },
      },
    });
    expect(cacheSecurityState).toHaveBeenCalledWith('docker.local', 'web', {
      signature: {
        status: 'verified',
      },
    });
  });

  test('maybeScanAndGateUpdate should no-op when security is disabled or scanner is not trivy', async () => {
    const disabledHarness = createGateHarness({
      securityConfiguration: {
        enabled: false,
      },
    });

    await disabledHarness.gate.maybeScanAndGateUpdate(
      createContext(),
      createContainer(),
      createLog(),
    );

    expect(disabledHarness.scanImageForVulnerabilities).not.toHaveBeenCalled();

    const wrongScannerHarness = createGateHarness({
      securityConfiguration: {
        scanner: 'grype',
      },
    });

    await wrongScannerHarness.gate.maybeScanAndGateUpdate(
      createContext(),
      createContainer(),
      createLog(),
    );

    expect(wrongScannerHarness.scanImageForVulnerabilities).not.toHaveBeenCalled();
  });

  test('maybeScanAndGateUpdate should rethrow non-pipeline scanner errors without recording failure audit', async () => {
    const recordSecurityAudit = vi.fn();
    const gate = new SecurityGate({
      getSecurityConfiguration: vi.fn(() => ({
        enabled: true,
        scanner: 'trivy',
        signature: {
          verify: false,
        },
        sbom: {
          enabled: false,
          formats: ['spdx-json'],
        },
      })),
      verifyImageSignature: vi.fn(),
      scanImageForVulnerabilities: vi
        .fn()
        .mockRejectedValue(new Error('docker daemon unavailable')),
      generateImageSbom: vi.fn(),
      emitSecurityAlert: vi.fn(),
      getContainer: vi.fn(() => createContainer()),
      updateContainer: vi.fn(),
      cacheSecurityState: vi.fn(),
      fullName: vi.fn((container) => `${container.watcher}/${container.name}`),
      recordSecurityAudit,
    });

    await expect(
      gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).rejects.toThrow('docker daemon unavailable');
    expect(recordSecurityAudit).not.toHaveBeenCalledWith(
      'security-scan-failed',
      expect.anything(),
      'error',
      expect.any(String),
    );
  });

  test('maybeScanAndGateUpdate should block on unverified image signatures', async () => {
    const harness = createGateHarness({
      securityConfiguration: {
        signature: {
          verify: true,
        },
      },
      verifyImageSignature: vi.fn().mockResolvedValue({
        status: 'unverified',
        error: 'signature not trusted',
      }),
    });

    await expect(
      harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).rejects.toThrow('Image signature verification failed: signature not trusted');

    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-signature-blocked',
      expect.anything(),
      'error',
      'Image signature verification failed: signature not trusted',
    );
    expect(harness.scanImageForVulnerabilities).not.toHaveBeenCalled();
  });

  test('maybeScanAndGateUpdate should expose a stable error code for unverified signatures', async () => {
    const harness = createGateHarness({
      securityConfiguration: {
        signature: {
          verify: true,
        },
      },
      verifyImageSignature: vi.fn().mockResolvedValue({
        status: 'unverified',
        error: 'signature not trusted',
      }),
    });

    await expect(
      harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).rejects.toMatchObject({
      code: 'security-signature-blocked',
    });
  });

  test('maybeScanAndGateUpdate should fail when signature verification errors', async () => {
    const harness = createGateHarness({
      securityConfiguration: {
        signature: {
          verify: true,
        },
      },
      verifyImageSignature: vi.fn().mockResolvedValue({
        status: 'error',
        error: 'cosign command failed',
      }),
    });

    await expect(
      harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).rejects.toThrow('Image signature verification failed: cosign command failed');

    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-signature-failed',
      expect.anything(),
      'error',
      'Image signature verification failed: cosign command failed',
    );
  });

  test('maybeScanAndGateUpdate should use default signature error message when scanner returns no error text', async () => {
    const harness = createGateHarness({
      securityConfiguration: {
        signature: {
          verify: true,
        },
      },
      verifyImageSignature: vi.fn().mockResolvedValue({
        status: 'unverified',
      }),
    });

    await expect(
      harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).rejects.toThrow('Image signature verification failed: no valid signatures found');

    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-signature-blocked',
      expect.anything(),
      'error',
      'Image signature verification failed: no valid signatures found',
    );
  });

  test('maybeScanAndGateUpdate should record verified signatures, generate SBOM, and pass clean scans', async () => {
    const harness = createGateHarness({
      securityConfiguration: {
        signature: {
          verify: true,
        },
        sbom: {
          enabled: true,
          formats: ['spdx-json', 'cyclonedx-json'],
        },
      },
      verifyImageSignature: vi.fn().mockResolvedValue({
        status: 'verified',
        signatures: 2,
      }),
      scanImageForVulnerabilities: vi.fn().mockResolvedValue({
        status: 'passed',
        summary: {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
          unknown: 4,
        },
        blockingCount: 0,
        blockSeverities: [],
      }),
      generateImageSbom: vi.fn().mockResolvedValue({
        status: 'generated',
        formats: ['spdx-json', 'cyclonedx-json'],
      }),
    });

    await harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog());

    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-signature-verified',
      expect.anything(),
      'success',
      'Image signature verified (2 signatures)',
    );
    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-sbom-generated',
      expect.anything(),
      'success',
      'SBOM generated (spdx-json, cyclonedx-json)',
    );
    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-scan-passed',
      expect.anything(),
      'success',
      'Security scan passed. Summary: critical=0, high=1, medium=2, low=3, unknown=4',
    );
    expect(harness.emitSecurityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: 'docker.local/web',
        status: 'passed',
        blockingCount: 0,
      }),
    );
    expect(harness.updateContainer).toHaveBeenCalledTimes(3);
  });

  test('maybeScanAndGateUpdate should record SBOM failures and stop on scan errors', async () => {
    const harness = createGateHarness({
      securityConfiguration: {
        sbom: {
          enabled: true,
          formats: ['spdx-json'],
        },
      },
      scanImageForVulnerabilities: vi.fn().mockResolvedValue({
        status: 'error',
        error: 'scanner crashed',
        summary: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          unknown: 0,
        },
        blockingCount: 0,
        blockSeverities: [],
      }),
      generateImageSbom: vi.fn().mockResolvedValue({
        status: 'error',
        error: 'sbom writer failed',
        formats: ['spdx-json'],
      }),
    });

    await expect(
      harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).rejects.toThrow('Security scan failed: scanner crashed');

    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-sbom-failed',
      expect.anything(),
      'error',
      'SBOM generation failed: sbom writer failed',
    );
    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-scan-failed',
      expect.anything(),
      'error',
      'Security scan failed: scanner crashed',
    );
    expect(harness.emitSecurityAlert).not.toHaveBeenCalled();
  });

  test('maybeScanAndGateUpdate should use default SBOM and scan error messages when provider omits error text', async () => {
    const harness = createGateHarness({
      securityConfiguration: {
        sbom: {
          enabled: true,
          formats: ['spdx-json'],
        },
      },
      scanImageForVulnerabilities: vi.fn().mockResolvedValue({
        status: 'error',
        summary: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          unknown: 0,
        },
        blockingCount: 0,
        blockSeverities: [],
      }),
      generateImageSbom: vi.fn().mockResolvedValue({
        status: 'error',
        formats: ['spdx-json'],
      }),
    });

    await expect(
      harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).rejects.toThrow('Security scan failed: unknown scanner error');

    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-sbom-failed',
      expect.anything(),
      'error',
      'SBOM generation failed: unknown SBOM error',
    );
    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-scan-failed',
      expect.anything(),
      'error',
      'Security scan failed: unknown scanner error',
    );
  });

  test('maybeScanAndGateUpdate should emit alerts and block updates for blocked scan results', async () => {
    const harness = createGateHarness({
      scanImageForVulnerabilities: vi.fn().mockResolvedValue({
        status: 'blocked',
        summary: {
          critical: 1,
          high: 2,
          medium: 0,
          low: 0,
          unknown: 0,
        },
        blockingCount: 3,
        blockSeverities: ['high', 'critical'],
      }),
    });

    await expect(
      harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).rejects.toThrow(
      'Security scan blocked update (3 vulnerabilities matched block severities: high, critical). Summary: critical=1, high=2, medium=0, low=0, unknown=0',
    );

    expect(harness.emitSecurityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: 'docker.local/web',
        blockingCount: 3,
      }),
    );
    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-scan-blocked',
      expect.anything(),
      'error',
      'Security scan blocked update (3 vulnerabilities matched block severities: high, critical). Summary: critical=1, high=2, medium=0, low=0, unknown=0',
    );
  });

  test('maybeScanAndGateUpdate should expose a stable error code for blocked scans', async () => {
    const harness = createGateHarness({
      scanImageForVulnerabilities: vi.fn().mockResolvedValue({
        status: 'blocked',
        summary: {
          critical: 1,
          high: 0,
          medium: 0,
          low: 0,
          unknown: 0,
        },
        blockingCount: 1,
        blockSeverities: ['critical'],
      }),
    });

    await expect(
      harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).rejects.toMatchObject({
      code: 'security-scan-blocked',
    });
  });

  test('maybeScanAndGateUpdate should not emit alerts when no high or critical vulnerabilities exist', async () => {
    const harness = createGateHarness({
      scanImageForVulnerabilities: vi.fn().mockResolvedValue({
        status: 'passed',
        summary: {
          critical: 0,
          high: 0,
          medium: 2,
          low: 3,
          unknown: 1,
        },
        blockingCount: 0,
        blockSeverities: [],
      }),
    });

    await harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog());

    expect(harness.emitSecurityAlert).not.toHaveBeenCalled();
    expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
      'security-scan-passed',
      expect.anything(),
      'success',
      'Security scan passed. Summary: critical=0, high=0, medium=2, low=3, unknown=1',
    );
  });

  test('constructor should support flat dependency modules', async () => {
    const scanImageForVulnerabilities = vi.fn().mockResolvedValue({
      status: 'passed',
      summary: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        unknown: 0,
      },
      blockingCount: 0,
      blockSeverities: [],
    });
    const gate = new SecurityGate({
      getSecurityConfiguration: vi.fn(() => ({
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: ['spdx-json'] },
      })),
      verifyImageSignature: vi.fn().mockResolvedValue({ status: 'verified', signatures: 1 }),
      scanImageForVulnerabilities,
      generateImageSbom: vi.fn().mockResolvedValue({ status: 'generated', formats: ['spdx-json'] }),
      getContainer: vi.fn(() => createContainer()),
      updateContainer: vi.fn(),
      cacheSecurityState: vi.fn(),
      emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
      fullName: vi.fn((container) => `${container.watcher}/${container.name}`),
      recordSecurityAudit: vi.fn(),
    });

    await gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog());

    expect(scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
  });

  test('persistSecurityState should map scan to updateScan when slot is update', async () => {
    const { gate, updateContainer, cacheSecurityState } = createGateHarness();
    const log = createLog();

    await gate.persistSecurityState(
      createContainer(),
      { scan: { status: 'passed' } },
      log,
      'update',
    );

    expect(updateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        security: expect.objectContaining({
          persisted: true,
          updateScan: { status: 'passed' },
        }),
      }),
    );
    // Should NOT have a top-level 'scan' key from this call
    const securityArg = updateContainer.mock.calls[0][0].security;
    expect(securityArg).not.toHaveProperty('scan');
  });

  test('persistSecurityState should preserve unmapped keys when slot is update', async () => {
    const { gate, updateContainer } = createGateHarness();

    await gate.persistSecurityState(
      createContainer(),
      {
        scan: { status: 'passed' },
        customState: { source: 'manual' },
      },
      createLog(),
      'update',
    );

    const securityArg = updateContainer.mock.calls[0][0].security;
    expect(securityArg.updateScan).toEqual({ status: 'passed' });
    expect(securityArg.customState).toEqual({ source: 'manual' });
  });

  test('persistSecurityState with update slot preserves existing scan field', async () => {
    const getContainer = vi.fn(() => ({
      id: 'container-id',
      watcher: 'docker.local',
      name: 'web',
      security: {
        scan: { status: 'passed', summary: {} },
      },
    }));
    const updateContainer = vi.fn();
    const cacheSecurityState = vi.fn();
    const gate = new SecurityGate({
      getSecurityConfiguration: vi.fn(),
      verifyImageSignature: vi.fn(),
      scanImageForVulnerabilities: vi.fn(),
      generateImageSbom: vi.fn(),
      emitSecurityAlert: vi.fn(),
      getContainer,
      updateContainer,
      cacheSecurityState,
      fullName: vi.fn(),
      recordSecurityAudit: vi.fn(),
    });

    await gate.persistSecurityState(
      createContainer(),
      { scan: { status: 'blocked' } },
      createLog(),
      'update',
    );

    const securityArg = updateContainer.mock.calls[0][0].security;
    expect(securityArg.scan).toEqual({ status: 'passed', summary: {} });
    expect(securityArg.updateScan).toEqual({ status: 'blocked' });
  });

  test('maybeScanAndGateUpdate should persist all security state to update slot', async () => {
    const updateContainer = vi.fn();
    const cacheSecurityState = vi.fn();
    const harness = createGateHarness({
      securityConfiguration: {
        signature: { verify: true },
        sbom: { enabled: true, formats: ['spdx-json'] },
      },
      updateContainer,
      cacheSecurityState,
      verifyImageSignature: vi.fn().mockResolvedValue({
        status: 'verified',
        signatures: 1,
      }),
      scanImageForVulnerabilities: vi.fn().mockResolvedValue({
        status: 'passed',
        summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
        blockingCount: 0,
        blockSeverities: [],
      }),
      generateImageSbom: vi.fn().mockResolvedValue({
        status: 'generated',
        formats: ['spdx-json'],
      }),
    });

    await harness.gate.maybeScanAndGateUpdate(
      { newImage: 'ghcr.io/acme/web:2.0.0', auth: {} },
      createContainer(),
      createLog(),
    );

    // All 3 calls should have mapped to update* fields
    for (const call of updateContainer.mock.calls) {
      const security = call[0].security;
      const hasUpdateField =
        'updateScan' in security || 'updateSignature' in security || 'updateSbom' in security;
      expect(hasUpdateField).toBe(true);
    }
  });
});
