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
  test('constructor should fail fast when required dependencies are missing', () => {
    expect(() => new SecurityGate({} as any)).toThrow(
      'SecurityGate requires dependency "getSecurityConfiguration"',
    );
  });

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

  test('getSecurityFailureAuditAction should return known failure codes unchanged', () => {
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
      recordSecurityAudit: vi.fn(),
    });

    expect(gate.getSecurityFailureAuditAction('security-signature-blocked')).toBe(
      'security-signature-blocked',
    );
    expect(gate.getSecurityFailureAuditAction('security-signature-failed')).toBe(
      'security-signature-failed',
    );
    expect(gate.getSecurityFailureAuditAction('security-scan-failed')).toBe('security-scan-failed');
    expect(gate.getSecurityFailureAuditAction('security-scan-blocked')).toBe(
      'security-scan-blocked',
    );
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
        slot: 'current',
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
          slot: 'current',
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
          slot: 'current',
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
        slot: 'current',
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

  test('persistSecurityState should map sbom to current security state by default', async () => {
    const { gate, updateContainer } = createGateHarness();

    await gate.persistSecurityState(
      createContainer(),
      {
        slot: 'current',
        sbom: {
          status: 'generated',
          formats: ['spdx-json'],
        },
      },
      createLog(),
    );

    expect(updateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        security: expect.objectContaining({
          sbom: {
            status: 'generated',
            formats: ['spdx-json'],
          },
        }),
      }),
    );
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
    const { gate, updateContainer } = createGateHarness();
    const log = createLog();

    await gate.persistSecurityState(
      createContainer(),
      { slot: 'update', scan: { status: 'passed' } },
      log,
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

  test('persistSecurityState should use an explicit patch slot discriminator', async () => {
    const { gate, updateContainer } = createGateHarness();

    await gate.persistSecurityState(
      createContainer(),
      {
        slot: 'update',
        scan: { status: 'passed' },
      },
      createLog(),
    );

    const securityArg = updateContainer.mock.calls[0][0].security;
    expect(securityArg).toEqual(
      expect.objectContaining({
        persisted: true,
        updateScan: { status: 'passed' },
      }),
    );
    expect(securityArg).not.toHaveProperty('scan');
    expect(securityArg).not.toHaveProperty('slot');
  });

  test('persistSecurityState should map signature and sbom when slot is update', async () => {
    const { gate, updateContainer } = createGateHarness();

    await gate.persistSecurityState(
      createContainer(),
      {
        slot: 'update',
        signature: { status: 'verified' },
        sbom: { status: 'generated' },
      },
      createLog(),
    );

    const securityArg = updateContainer.mock.calls[0][0].security;
    expect(securityArg.updateSignature).toEqual({ status: 'verified' });
    expect(securityArg.updateSbom).toEqual({ status: 'generated' });
    expect(securityArg).not.toHaveProperty('signature');
    expect(securityArg).not.toHaveProperty('sbom');
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
      { slot: 'update', scan: { status: 'blocked' } },
      createLog(),
    );

    const securityArg = updateContainer.mock.calls[0][0].security;
    expect(securityArg.scan).toEqual({ status: 'passed', summary: {} });
    expect(securityArg.updateScan).toEqual({ status: 'blocked' });
  });

  test('maybeEmitHighSeverityAlert swallows emitSecurityAlert rejection silently', async () => {
    const harness = createGateHarness();
    harness.emitSecurityAlert.mockRejectedValue(new Error('network timeout'));
    harness.scanImageForVulnerabilities.mockResolvedValue({
      status: 'passed',
      summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
      blockingCount: 0,
      blockSeverities: [],
    });

    // Should resolve without throwing even though emitSecurityAlert rejects
    await expect(
      harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog()),
    ).resolves.toBeUndefined();

    // Drain the microtask that fires the catch
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // -------------------------------------------------------------------------
  // getEffectiveGateMode — direct unit tests
  // -------------------------------------------------------------------------

  describe('getEffectiveGateMode', () => {
    test('container label dd.security.gate=on returns on regardless of config', () => {
      const { gate } = createGateHarness({
        securityConfiguration: { gate: { mode: 'off' } },
      });
      const container = createContainer({ labels: { 'dd.security.gate': 'on' } });
      const config = gate.securityConfig.getSecurityConfiguration();
      expect(gate.getEffectiveGateMode(container, config)).toBe('on');
    });

    test('container label dd.security.gate=off returns off regardless of config', () => {
      const { gate } = createGateHarness({
        securityConfiguration: { gate: { mode: 'on' } },
      });
      const container = createContainer({ labels: { 'dd.security.gate': 'off' } });
      const config = gate.securityConfig.getSecurityConfiguration();
      expect(gate.getEffectiveGateMode(container, config)).toBe('off');
    });

    test('label is case-insensitive', () => {
      const { gate, securityConfiguration } = createGateHarness();
      const container = createContainer({ labels: { 'dd.security.gate': 'OFF' } });
      expect(gate.getEffectiveGateMode(container, securityConfiguration)).toBe('off');
    });

    test('unrecognised label values fall back to the config gate mode', () => {
      const { gate } = createGateHarness({
        securityConfiguration: { gate: { mode: 'off' } },
      });
      const container = createContainer({ labels: { 'dd.security.gate': 'maybe' } });
      const config = gate.securityConfig.getSecurityConfiguration();
      expect(gate.getEffectiveGateMode(container, config)).toBe('off');
    });

    test('no container label uses the config gate mode', () => {
      const { gate } = createGateHarness({
        securityConfiguration: { gate: { mode: 'off' } },
      });
      const container = createContainer();
      const config = gate.securityConfig.getSecurityConfiguration();
      expect(gate.getEffectiveGateMode(container, config)).toBe('off');
    });

    test('no container label and no gate field in config returns the secure default (on)', () => {
      const { gate, securityConfiguration } = createGateHarness();
      const container = createContainer();
      expect(gate.getEffectiveGateMode(container, securityConfiguration)).toBe('on');
    });
  });

  // -------------------------------------------------------------------------
  // maybeScanAndGateUpdate — gate.mode='off'
  // -------------------------------------------------------------------------

  describe("maybeScanAndGateUpdate with gate.mode='off'", () => {
    test('signature verification still runs when enabled and gate is off', async () => {
      const harness = createGateHarness({
        securityConfiguration: {
          gate: { mode: 'off' },
          signature: { verify: true },
        },
      });

      await harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog());

      expect(harness.verifyImageSignature).toHaveBeenCalledTimes(1);
    });

    test('scanImageForVulnerabilities is NOT called when gate is off', async () => {
      const harness = createGateHarness({
        securityConfiguration: { gate: { mode: 'off' } },
      });

      await harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog());

      expect(harness.scanImageForVulnerabilities).not.toHaveBeenCalled();
    });

    test('generateImageSbom is NOT called when gate is off', async () => {
      const harness = createGateHarness({
        securityConfiguration: {
          gate: { mode: 'off' },
          sbom: { enabled: true, formats: ['spdx-json'] },
        },
      });

      await harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog());

      expect(harness.generateImageSbom).not.toHaveBeenCalled();
    });

    test('logs an info line so operators have visibility into bypassed scans', async () => {
      const log = createLog();
      const harness = createGateHarness({
        securityConfiguration: { gate: { mode: 'off' } },
      });

      await harness.gate.maybeScanAndGateUpdate(createContext(), createContainer(), log);

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Security gate disabled'));
    });

    test('records audit row when scans are skipped by global gate off mode', async () => {
      const harness = createGateHarness({
        securityConfiguration: { gate: { mode: 'off' } },
      });
      const container = createContainer();

      await harness.gate.maybeScanAndGateUpdate(createContext(), container, createLog());

      expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
        'security-scan-skipped',
        container,
        'info',
        'Security scan skipped because DD_SECURITY_GATE_MODE=off is configured globally',
      );
    });

    test('describes an effective gate-off skip when no direct off source is present', () => {
      const harness = createGateHarness({
        securityConfiguration: { gate: { mode: 'on' } },
      });

      expect(
        harness.gate.getGateDisabledAuditDetails(createContainer(), { gate: { mode: 'on' } }),
      ).toBe('Security scan skipped because the effective security gate mode is off');
    });
  });

  // -------------------------------------------------------------------------
  // Container label overrides config gate mode
  // -------------------------------------------------------------------------

  describe('container label overrides config gate mode', () => {
    test("config gate.mode='on' overridden by label dd.security.gate=off — no scan", async () => {
      const harness = createGateHarness({
        securityConfiguration: { gate: { mode: 'on' } },
      });
      const container = createContainer({ labels: { 'dd.security.gate': 'off' } });

      await harness.gate.maybeScanAndGateUpdate(createContext(), container, createLog());

      expect(harness.scanImageForVulnerabilities).not.toHaveBeenCalled();
      expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
        'security-scan-skipped',
        container,
        'info',
        'Security scan skipped because dd.security.gate=off is set on the container',
      );
    });

    test("config gate.mode='off' overridden by label dd.security.gate=on — scan runs and gates", async () => {
      const harness = createGateHarness({
        securityConfiguration: { gate: { mode: 'off' } },
      });
      const container = createContainer({ labels: { 'dd.security.gate': 'on' } });

      await harness.gate.maybeScanAndGateUpdate(createContext(), container, createLog());

      expect(harness.scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
      expect(harness.recordSecurityAudit).toHaveBeenCalledWith(
        'security-scan-passed',
        expect.anything(),
        'success',
        expect.any(String),
      );
    });
  });

  // -------------------------------------------------------------------------
  // scanImageForUpdate — scan-cache short-circuit
  // -------------------------------------------------------------------------

  describe('scanImageForUpdate scan-cache short-circuit', () => {
    function createCacheHarness(overrides = {}) {
      const passedScanResult = {
        status: 'passed' as const,
        summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
        blockingCount: 0,
        blockSeverities: [] as string[],
      };

      const scanImageWithDedup = vi.fn().mockResolvedValue({
        scanResult: passedScanResult,
        fromCache: false,
      });
      const scanImageForVulnerabilities = vi.fn().mockResolvedValue(passedScanResult);
      const getTrivyDbUpdatedAt = vi.fn().mockResolvedValue('2026-01-01T00:00:00Z');
      const getScanIntervalMs = vi.fn().mockReturnValue(86400000);

      const gate = new SecurityGate({
        getSecurityConfiguration: vi.fn(() => ({
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: false, formats: ['spdx-json'] },
        })),
        verifyImageSignature: vi.fn().mockResolvedValue({ status: 'verified', signatures: 1 }),
        scanImageForVulnerabilities,
        generateImageSbom: vi
          .fn()
          .mockResolvedValue({ status: 'generated', formats: ['spdx-json'] }),
        emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
        getContainer: vi.fn(() => createContainer()),
        updateContainer: vi.fn(),
        cacheSecurityState: vi.fn(),
        fullName: vi.fn((c) => `${c.watcher}/${c.name}`),
        recordSecurityAudit: vi.fn(),
        scanImageWithDedup,
        getTrivyDbUpdatedAt,
        getScanIntervalMs,
        ...overrides,
      });

      return {
        gate,
        scanImageWithDedup,
        scanImageForVulnerabilities,
        getTrivyDbUpdatedAt,
        getScanIntervalMs,
        passedScanResult,
      };
    }

    function makeDockerApi(digest: string | undefined) {
      return {
        getImage: () => ({
          inspect: async () => ({
            RepoDigests: digest ? [`ghcr.io/acme/web@${digest}`] : [],
          }),
        }),
      };
    }

    test('calls scanImageWithDedup and NOT scanImageForVulnerabilities when digest resolves', async () => {
      const { gate, scanImageWithDedup, scanImageForVulnerabilities } = createCacheHarness();
      const context = {
        newImage: 'ghcr.io/acme/web:2.0.0',
        auth: { username: 'bot', password: 'token' },
        dockerApi: makeDockerApi('sha256:abc123'),
      };

      await gate.scanImageForUpdate(context, createContainer(), createLog());

      expect(scanImageWithDedup).toHaveBeenCalledTimes(1);
      expect(scanImageWithDedup).toHaveBeenCalledWith(
        expect.objectContaining({ digest: 'sha256:abc123', image: 'ghcr.io/acme/web:2.0.0' }),
        86400000,
      );
      expect(scanImageForVulnerabilities).not.toHaveBeenCalled();
    });

    test('falls back to scanImageForVulnerabilities when digest does not resolve', async () => {
      const { gate, scanImageWithDedup, scanImageForVulnerabilities } = createCacheHarness();
      const context = {
        newImage: 'ghcr.io/acme/web:2.0.0',
        auth: {},
        dockerApi: makeDockerApi(undefined),
      };

      await gate.scanImageForUpdate(context, createContainer(), createLog());

      expect(scanImageWithDedup).not.toHaveBeenCalled();
      expect(scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
    });

    test('falls back to scanImageForVulnerabilities when scanImageWithDedup is not provided', async () => {
      const { gate, scanImageForVulnerabilities } = createCacheHarness({
        scanImageWithDedup: undefined,
      });
      const context = {
        newImage: 'ghcr.io/acme/web:2.0.0',
        auth: {},
        dockerApi: makeDockerApi('sha256:abc123'),
      };

      await gate.scanImageForUpdate(context, createContainer(), createLog());

      expect(scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
    });

    test('falls back to scanImageForVulnerabilities when dockerApi is not in context', async () => {
      const { gate, scanImageWithDedup, scanImageForVulnerabilities } = createCacheHarness();
      const context = {
        newImage: 'ghcr.io/acme/web:2.0.0',
        auth: {},
      };

      await gate.scanImageForUpdate(context, createContainer(), createLog());

      expect(scanImageWithDedup).not.toHaveBeenCalled();
      expect(scanImageForVulnerabilities).toHaveBeenCalledTimes(1);
    });

    test('logs "Using cached scan result" at info level when fromCache is true', async () => {
      const { gate } = createCacheHarness({
        scanImageWithDedup: vi.fn().mockResolvedValue({
          scanResult: {
            status: 'passed',
            summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
            blockingCount: 0,
            blockSeverities: [],
          },
          fromCache: true,
        }),
      });
      const log = createLog();
      const context = {
        newImage: 'ghcr.io/acme/web:2.0.0',
        auth: {},
        dockerApi: makeDockerApi('sha256:abc123'),
      };

      await gate.scanImageForUpdate(context, createContainer(), log);

      expect(log.info).toHaveBeenCalledWith('Using cached scan result');
    });

    test('does not log cache message when fromCache is false', async () => {
      const { gate } = createCacheHarness({
        scanImageWithDedup: vi.fn().mockResolvedValue({
          scanResult: {
            status: 'passed',
            summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
            blockingCount: 0,
            blockSeverities: [],
          },
          fromCache: false,
        }),
      });
      const log = createLog();
      const context = {
        newImage: 'ghcr.io/acme/web:2.0.0',
        auth: {},
        dockerApi: makeDockerApi('sha256:abc123'),
      };

      await gate.scanImageForUpdate(context, createContainer(), log);

      expect(log.info).not.toHaveBeenCalledWith('Using cached scan result');
    });

    test('uses DEFAULT_SCAN_INTERVAL_MS fallback when getScanIntervalMs is not provided', async () => {
      const scanImageWithDedup = vi.fn().mockResolvedValue({
        scanResult: {
          status: 'passed',
          summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
          blockingCount: 0,
          blockSeverities: [],
        },
        fromCache: false,
      });
      const { gate } = createCacheHarness({
        scanImageWithDedup,
        getScanIntervalMs: undefined,
      });
      const context = {
        newImage: 'ghcr.io/acme/web:2.0.0',
        auth: {},
        dockerApi: makeDockerApi('sha256:abc123'),
      };

      await gate.scanImageForUpdate(context, createContainer(), createLog());

      expect(scanImageWithDedup).toHaveBeenCalledWith(expect.anything(), 24 * 60 * 60 * 1000);
    });
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

  describe('verifySignaturePreUpdate', () => {
    test('should skip when security gate is not enabled', async () => {
      const { gate, verifyImageSignature } = createGateHarness({
        securityConfiguration: { enabled: false, scanner: 'trivy', signature: { verify: true } },
      });
      await gate.verifySignaturePreUpdate(createContext(), createContainer(), createLog());
      expect(verifyImageSignature).not.toHaveBeenCalled();
    });

    test('should skip when signature.verify is false', async () => {
      const { gate, verifyImageSignature } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: false, formats: ['spdx-json'] },
        },
      });
      await gate.verifySignaturePreUpdate(createContext(), createContainer(), createLog());
      expect(verifyImageSignature).not.toHaveBeenCalled();
    });

    test('should call maybeVerifyImageSignatureForUpdate when signature.verify is true', async () => {
      const { gate, verifyImageSignature } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: true },
          sbom: { enabled: false, formats: ['spdx-json'] },
          gate: { mode: 'on' },
          prune: { onBlock: true },
        },
      });
      await gate.verifySignaturePreUpdate(createContext(), createContainer(), createLog());
      expect(verifyImageSignature).toHaveBeenCalledTimes(1);
    });

    test('should record and rethrow signature failure', async () => {
      const { gate, recordSecurityAudit } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: true },
          sbom: { enabled: false, formats: ['spdx-json'] },
          gate: { mode: 'on' },
          prune: { onBlock: true },
        },
        verifyImageSignature: vi.fn().mockResolvedValue({
          status: 'unverified',
          signatures: 0,
          error: 'no matching signatures',
        }),
      });
      await expect(
        gate.verifySignaturePreUpdate(createContext(), createContainer(), createLog()),
      ).rejects.toThrow();
      expect(recordSecurityAudit).toHaveBeenCalledWith(
        'security-signature-blocked',
        expect.any(Object),
        'error',
        expect.any(String),
      );
    });
  });

  describe('scanAndGatePostPull', () => {
    test('should skip when security gate is not enabled', async () => {
      const { gate, scanImageForVulnerabilities } = createGateHarness({
        securityConfiguration: { enabled: false, scanner: 'trivy', signature: { verify: false } },
      });
      await gate.scanAndGatePostPull(createContext(), createContainer(), createLog());
      expect(scanImageForVulnerabilities).not.toHaveBeenCalled();
    });

    test('should skip scan when gate mode is off', async () => {
      const { gate, scanImageForVulnerabilities } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: false, formats: ['spdx-json'] },
          gate: { mode: 'off' },
          prune: { onBlock: true },
        },
      });
      await gate.scanAndGatePostPull(createContext(), createContainer(), createLog());
      expect(scanImageForVulnerabilities).not.toHaveBeenCalled();
    });

    test('should call setPhase with scanning and sbom-generating when sbom is enabled', async () => {
      const { gate } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: true, formats: ['spdx-json'] },
          gate: { mode: 'on' },
          prune: { onBlock: true },
        },
      });
      const setPhase = vi.fn();
      await gate.scanAndGatePostPull(createContext(), createContainer(), createLog(), { setPhase });
      expect(setPhase).toHaveBeenCalledWith('scanning');
      expect(setPhase).toHaveBeenCalledWith('sbom-generating');
    });

    test('should call setPhase with only scanning when sbom is disabled', async () => {
      const { gate } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: false, formats: ['spdx-json'] },
          gate: { mode: 'on' },
          prune: { onBlock: true },
        },
      });
      const setPhase = vi.fn();
      await gate.scanAndGatePostPull(createContext(), createContainer(), createLog(), { setPhase });
      expect(setPhase).toHaveBeenCalledWith('scanning');
      expect(setPhase).not.toHaveBeenCalledWith('sbom-generating');
    });

    test('should call pruneImage on block when prune.onBlock is true', async () => {
      const pruneImage = vi.fn().mockResolvedValue(undefined);
      const { gate } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: false, formats: ['spdx-json'] },
          gate: { mode: 'on' },
          prune: { onBlock: true },
        },
        scanImageForVulnerabilities: vi.fn().mockResolvedValue({
          status: 'blocked',
          summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
          blockingCount: 1,
          blockSeverities: ['CRITICAL'],
        }),
        pruneImage,
      });
      await expect(
        gate.scanAndGatePostPull(createContext(), createContainer(), createLog()),
      ).rejects.toThrow();
      expect(pruneImage).toHaveBeenCalledWith('ghcr.io/acme/web:2.0.0', undefined);
    });

    test('should not call pruneImage on block when prune.onBlock is false', async () => {
      const pruneImage = vi.fn().mockResolvedValue(undefined);
      const { gate } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: false, formats: ['spdx-json'] },
          gate: { mode: 'on' },
          prune: { onBlock: false },
        },
        scanImageForVulnerabilities: vi.fn().mockResolvedValue({
          status: 'blocked',
          summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
          blockingCount: 1,
          blockSeverities: ['CRITICAL'],
        }),
        pruneImage,
      });
      await expect(
        gate.scanAndGatePostPull(createContext(), createContainer(), createLog()),
      ).rejects.toThrow();
      expect(pruneImage).not.toHaveBeenCalled();
    });

    test('should warn and continue when pruneImage throws', async () => {
      const pruneImage = vi.fn().mockRejectedValue(new Error('docker remove failed'));
      const { gate } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: false, formats: ['spdx-json'] },
          gate: { mode: 'on' },
          prune: { onBlock: true },
        },
        scanImageForVulnerabilities: vi.fn().mockResolvedValue({
          status: 'blocked',
          summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
          blockingCount: 1,
          blockSeverities: ['CRITICAL'],
        }),
        pruneImage,
      });
      const log = createLog();
      await expect(
        gate.scanAndGatePostPull(createContext(), createContainer(), log),
      ).rejects.toThrow();
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to prune blocked image'),
      );
    });
  });

  describe('direct security step skips', () => {
    test('maybeVerifyImageSignatureForUpdate should return when signature verification is disabled', async () => {
      const { gate, verifyImageSignature } = createGateHarness();

      await gate.maybeVerifyImageSignatureForUpdate(
        createContext(),
        createContainer(),
        createLog(),
        {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: false },
          sbom: { enabled: false, formats: ['spdx-json'] },
        },
      );

      expect(verifyImageSignature).not.toHaveBeenCalled();
    });

    test('maybeGenerateSbomForUpdate should return when SBOM generation is disabled', async () => {
      const { gate, generateImageSbom } = createGateHarness();

      await gate.maybeGenerateSbomForUpdate(createContext(), createContainer(), createLog(), {
        enabled: true,
        scanner: 'trivy',
        signature: { verify: false },
        sbom: { enabled: false, formats: ['spdx-json'] },
      });

      expect(generateImageSbom).not.toHaveBeenCalled();
    });

    test('scanImageForUpdate should use dedupe cache without trivy database timestamp provider', async () => {
      const scanResult = {
        status: 'passed',
        summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
        blockingCount: 0,
        blockSeverities: [],
      };
      const scanImageWithDedup = vi.fn().mockResolvedValue({
        scanResult,
        fromCache: false,
      });
      const { gate } = createGateHarness({
        scanImageWithDedup,
        getTrivyDbUpdatedAt: undefined,
        getScanIntervalMs: vi.fn(() => 123_456),
      });
      const dockerApi = {
        getImage: vi.fn(() => ({
          inspect: vi.fn().mockResolvedValue({
            RepoDigests: ['ghcr.io/acme/web@sha256:abc123'],
          }),
        })),
      };

      await expect(
        gate.scanImageForUpdate(createContext({ dockerApi }), createContainer(), createLog()),
      ).resolves.toBe(scanResult);

      expect(scanImageWithDedup).toHaveBeenCalledWith(
        expect.objectContaining({
          digest: 'sha256:abc123',
          trivyDbUpdatedAt: undefined,
        }),
        123_456,
      );
    });

    test('verifySignaturePreUpdate should rethrow non-pipeline signature errors without audit mapping', async () => {
      const { gate, recordSecurityAudit } = createGateHarness({
        securityConfiguration: {
          enabled: true,
          scanner: 'trivy',
          signature: { verify: true },
          sbom: { enabled: false, formats: ['spdx-json'] },
        },
      });
      vi.spyOn(gate, 'maybeVerifyImageSignatureForUpdate').mockRejectedValueOnce(
        new Error('cosign crashed'),
      );

      await expect(
        gate.verifySignaturePreUpdate(createContext(), createContainer(), createLog()),
      ).rejects.toThrow('cosign crashed');

      expect(recordSecurityAudit).not.toHaveBeenCalled();
    });
  });

  describe('maybeScanAndGateUpdate (combined wrapper)', () => {
    test('should call verifySignaturePreUpdate then scanAndGatePostPull', async () => {
      const { gate } = createGateHarness();
      const verifySpy = vi.spyOn(gate, 'verifySignaturePreUpdate').mockResolvedValue(undefined);
      const scanSpy = vi.spyOn(gate, 'scanAndGatePostPull').mockResolvedValue(undefined);
      await gate.maybeScanAndGateUpdate(createContext(), createContainer(), createLog());
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(scanSpy).toHaveBeenCalledTimes(1);
    });
  });
});
