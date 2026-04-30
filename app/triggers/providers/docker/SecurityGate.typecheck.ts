import SecurityGate from './SecurityGate.js';

const baseDependencies: NonNullable<ConstructorParameters<typeof SecurityGate>[0]> = {
  getSecurityConfiguration: () => ({
    enabled: false,
    scanner: 'trivy',
    signature: { verify: false },
    sbom: { enabled: false, formats: ['spdx-json'] },
    gate: { mode: 'on' },
  }),
  verifyImageSignature: async () => ({
    verifier: 'cosign',
    image: 'ghcr.io/acme/web:2.0.0',
    verifiedAt: new Date().toISOString(),
    status: 'verified',
    keyless: true,
    signatures: 1,
  }),
  scanImageForVulnerabilities: async () => ({
    scanner: 'trivy',
    image: 'ghcr.io/acme/web:2.0.0',
    scannedAt: new Date().toISOString(),
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
    vulnerabilities: [],
  }),
  generateImageSbom: async () => ({
    generator: 'trivy',
    image: 'ghcr.io/acme/web:2.0.0',
    generatedAt: new Date().toISOString(),
    status: 'generated',
    formats: ['spdx-json'],
    documents: {
      'spdx-json': {},
    },
  }),
  emitSecurityAlert: async () => undefined,
  getContainer: () => undefined,
  updateContainer: () => undefined,
  cacheSecurityState: () => undefined,
  fullName: () => 'docker.local/web',
};

new SecurityGate(baseDependencies);

// @ts-expect-error core dependencies are required
new SecurityGate({});

// @ts-expect-error constructor options are required
new SecurityGate();

new SecurityGate({
  // @ts-expect-error grouped dependencies are not accepted
  securityConfig: {
    getSecurityConfiguration: baseDependencies.getSecurityConfiguration,
  },
});

new SecurityGate({
  ...baseDependencies,
  // @ts-expect-error verifyImageSignature must be a function
  verifyImageSignature: 123,
});

type IsAny<T> = 0 extends 1 & T ? true : false;
type ExpectNotAny<T> = IsAny<T> extends true ? false : true;

const createSecurityFailureCodeIsTyped: ExpectNotAny<
  Parameters<SecurityGate['createSecurityFailure']>[0]
> = true;
const createSecurityFailureMessageIsTyped: ExpectNotAny<
  Parameters<SecurityGate['createSecurityFailure']>[1]
> = true;
const persistSecurityStateContainerIsTyped: ExpectNotAny<
  Parameters<SecurityGate['persistSecurityState']>[0]
> = true;
const persistSecurityStatePatchIsTyped: ExpectNotAny<
  Parameters<SecurityGate['persistSecurityState']>[1]
> = true;
const persistSecurityStateLogIsTyped: ExpectNotAny<
  Parameters<SecurityGate['persistSecurityState']>[2]
> = true;
const maybeScanAndGateUpdateContextIsTyped: ExpectNotAny<
  Parameters<SecurityGate['maybeScanAndGateUpdate']>[0]
> = true;
const maybeScanAndGateUpdateContainerIsTyped: ExpectNotAny<
  Parameters<SecurityGate['maybeScanAndGateUpdate']>[1]
> = true;
const maybeScanAndGateUpdateLogIsTyped: ExpectNotAny<
  Parameters<SecurityGate['maybeScanAndGateUpdate']>[2]
> = true;

void createSecurityFailureCodeIsTyped;
void createSecurityFailureMessageIsTyped;
void persistSecurityStateContainerIsTyped;
void persistSecurityStatePatchIsTyped;
void persistSecurityStateLogIsTyped;
void maybeScanAndGateUpdateContextIsTyped;
void maybeScanAndGateUpdateContainerIsTyped;
void maybeScanAndGateUpdateLogIsTyped;
