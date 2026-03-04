import SecurityGate from './SecurityGate.js';

const baseDependencies: NonNullable<ConstructorParameters<typeof SecurityGate>[0]> = {
  getSecurityConfiguration: () => ({
    enabled: false,
    scanner: 'trivy',
    signature: { verify: false },
    sbom: { enabled: false, formats: ['spdx-json'] },
  }),
  verifyImageSignature: async () => ({ status: 'verified', signatures: 1 }),
  scanImageForVulnerabilities: async () => ({
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
  }),
  generateImageSbom: async () => ({ status: 'generated', formats: ['spdx-json'] }),
  emitSecurityAlert: async () => undefined,
  getContainer: () => undefined,
  updateContainer: () => undefined,
  cacheSecurityState: () => undefined,
  fullName: () => 'docker.local/web',
};

new SecurityGate(baseDependencies);
new SecurityGate({
  securityConfig: {
    getSecurityConfiguration: baseDependencies.getSecurityConfiguration,
  },
  scanners: {
    verifyImageSignature: baseDependencies.verifyImageSignature,
    scanImageForVulnerabilities: baseDependencies.scanImageForVulnerabilities,
    generateImageSbom: baseDependencies.generateImageSbom,
  },
  stateStore: {
    getContainer: baseDependencies.getContainer,
    updateContainer: baseDependencies.updateContainer,
    cacheSecurityState: baseDependencies.cacheSecurityState,
  },
  telemetry: {
    emitSecurityAlert: baseDependencies.emitSecurityAlert,
    fullName: baseDependencies.fullName,
  },
});

new SecurityGate({
  ...baseDependencies,
  // @ts-expect-error verifyImageSignature must be a function
  verifyImageSignature: 123,
});
