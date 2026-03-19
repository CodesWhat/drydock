import type { SecurityConfiguration, SecuritySbomFormat } from '../../../configuration/index.js';
import type { Container } from '../../../model/container.js';
import type {
  ContainerSecuritySbom,
  ContainerSecurityScan,
  ContainerSignatureVerification,
  ContainerVulnerabilitySummary,
} from '../../../security/scan.js';
import { getErrorMessage } from '../../../util/error.js';
import { resolveFunctionDependencies } from './dependency-constructor.js';
import TriggerPipelineError from './TriggerPipelineError.js';

type SecurityContainer = Container;
type SecurityState = SecurityContainer['security'];
type PersistedSecurityState = NonNullable<SecurityState>;

type SecurityFailureCode =
  | 'security-signature-blocked'
  | 'security-signature-failed'
  | 'security-scan-failed'
  | 'security-scan-blocked';

const SECURITY_FAILURE_AUDIT_CODES = [
  'security-signature-blocked',
  'security-signature-failed',
  'security-scan-failed',
  'security-scan-blocked',
] as const satisfies readonly SecurityFailureCode[];

function isSecurityFailureCode(code: string): code is SecurityFailureCode {
  return SECURITY_FAILURE_AUDIT_CODES.includes(code as SecurityFailureCode);
}

type SecurityStatePatch = Partial<PersistedSecurityState> & Record<string, unknown>;

type SecurityGateLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

type SecurityGateUpdateContext = {
  newImage: string;
  auth: SecurityScannerRequest['auth'];
};

type SecurityScannerRequest = {
  image: string;
  auth: unknown;
};

type SignatureScanResult = ContainerSignatureVerification;
type VulnerabilitySummary = ContainerVulnerabilitySummary;
type VulnerabilityScanResult = ContainerSecurityScan;
type SbomResult = ContainerSecuritySbom;

type SecurityAlertPayload = {
  containerName: string;
  details: string;
  status: string;
  summary: VulnerabilitySummary;
  blockingCount: number;
  container: SecurityContainer;
};

type SecurityGateDependencies = {
  getSecurityConfiguration: () => SecurityConfiguration;
  verifyImageSignature: (request: SecurityScannerRequest) => Promise<SignatureScanResult>;
  scanImageForVulnerabilities: (
    request: SecurityScannerRequest,
  ) => Promise<VulnerabilityScanResult>;
  generateImageSbom: (
    request: SecurityScannerRequest & { formats: SecuritySbomFormat[] },
  ) => Promise<SbomResult>;
  getContainer: (containerId: string) => SecurityContainer | undefined;
  updateContainer: (container: SecurityContainer) => void;
  cacheSecurityState: (
    watcher: string,
    containerName: string,
    securityState: SecurityState,
  ) => void;
  emitSecurityAlert: (payload: SecurityAlertPayload) => Promise<void>;
  fullName: (container: SecurityContainer) => string;
  recordSecurityAudit: (
    action: string,
    container: SecurityContainer,
    status: 'success' | 'error',
    details: string,
  ) => void;
};

type SecurityGateConstructorOptions = Omit<SecurityGateDependencies, 'recordSecurityAudit'> & {
  recordSecurityAudit?: SecurityGateDependencies['recordSecurityAudit'];
};

const REQUIRED_SECURITY_GATE_DEPENDENCY_KEYS = [
  'getSecurityConfiguration',
  'verifyImageSignature',
  'scanImageForVulnerabilities',
  'generateImageSbom',
  'getContainer',
  'updateContainer',
  'cacheSecurityState',
  'emitSecurityAlert',
  'fullName',
] as const;

class SecurityGate {
  securityConfig: Pick<SecurityGateDependencies, 'getSecurityConfiguration'>;

  scanners: Pick<
    SecurityGateDependencies,
    'verifyImageSignature' | 'scanImageForVulnerabilities' | 'generateImageSbom'
  >;

  stateStore: Pick<
    SecurityGateDependencies,
    'getContainer' | 'updateContainer' | 'cacheSecurityState'
  >;

  telemetry: Pick<
    SecurityGateDependencies,
    'emitSecurityAlert' | 'fullName' | 'recordSecurityAudit'
  >;

  constructor(options: SecurityGateConstructorOptions) {
    const dependencies = resolveFunctionDependencies<SecurityGateDependencies>(options, {
      requiredKeys: REQUIRED_SECURITY_GATE_DEPENDENCY_KEYS,
      defaults: {
        recordSecurityAudit: () => undefined,
      },
      componentName: 'SecurityGate',
    });
    this.securityConfig = {
      getSecurityConfiguration: dependencies.getSecurityConfiguration,
    };
    this.scanners = {
      verifyImageSignature: dependencies.verifyImageSignature,
      scanImageForVulnerabilities: dependencies.scanImageForVulnerabilities,
      generateImageSbom: dependencies.generateImageSbom,
    };
    this.stateStore = {
      getContainer: dependencies.getContainer,
      updateContainer: dependencies.updateContainer,
      cacheSecurityState: dependencies.cacheSecurityState,
    };
    this.telemetry = {
      emitSecurityAlert: dependencies.emitSecurityAlert,
      fullName: dependencies.fullName,
      recordSecurityAudit: dependencies.recordSecurityAudit,
    };
  }

  createSecurityFailure(code: SecurityFailureCode, message: string): TriggerPipelineError {
    return new TriggerPipelineError(code, message, {
      source: 'SecurityGate',
    });
  }

  getSecurityFailureAuditAction(code: string): SecurityFailureCode | undefined {
    return isSecurityFailureCode(code) ? code : undefined;
  }

  recordSecurityFailure(container: SecurityContainer, error: { code: string; message: string }) {
    const action = this.getSecurityFailureAuditAction(error.code);
    if (!action) {
      return;
    }
    this.telemetry.recordSecurityAudit(action, container, 'error', error.message);
  }

  async persistSecurityState(
    container: SecurityContainer,
    securityPatch: SecurityStatePatch,
    logContainer: SecurityGateLogger,
    slot: 'current' | 'update' = 'current',
  ): Promise<void> {
    try {
      const mappedPatch: SecurityStatePatch =
        slot === 'update'
          ? Object.fromEntries(
              Object.entries(securityPatch).map(([key, value]) => {
                if (key === 'scan') return ['updateScan', value];
                if (key === 'signature') return ['updateSignature', value];
                if (key === 'sbom') return ['updateSbom', value];
                return [key, value];
              }),
            )
          : securityPatch;
      const containerCurrent = this.stateStore.getContainer(container.id);
      const containerWithSecurity = {
        ...(containerCurrent || container),
        security: {
          ...((containerCurrent || container).security || {}),
          ...mappedPatch,
        },
      };
      this.stateStore.updateContainer(containerWithSecurity);
      this.stateStore.cacheSecurityState(
        container.watcher,
        container.name,
        containerWithSecurity.security,
      );
    } catch (e: unknown) {
      logContainer.warn(`Unable to persist security state (${getErrorMessage(e)})`);
    }
  }

  shouldRunSecurityGate(securityConfiguration: SecurityConfiguration): boolean {
    return securityConfiguration.enabled && securityConfiguration.scanner === 'trivy';
  }

  async maybeVerifyImageSignatureForUpdate(
    context: SecurityGateUpdateContext,
    container: SecurityContainer,
    logContainer: SecurityGateLogger,
    securityConfiguration: SecurityConfiguration,
  ): Promise<void> {
    if (!securityConfiguration.signature.verify) {
      return;
    }

    logContainer.info(`Verifying image signature for candidate image ${context.newImage}`);
    const signatureResult = await this.scanners.verifyImageSignature({
      image: context.newImage,
      auth: context.auth,
    });
    await this.persistSecurityState(
      container,
      { signature: signatureResult },
      logContainer,
      'update',
    );

    if (signatureResult.status === 'verified') {
      this.telemetry.recordSecurityAudit(
        'security-signature-verified',
        container,
        'success',
        `Image signature verified (${signatureResult.signatures} signatures)`,
      );
      return;
    }

    const details = `Image signature verification failed: ${
      signatureResult.error || 'no valid signatures found'
    }`;
    throw this.createSecurityFailure(
      signatureResult.status === 'unverified'
        ? 'security-signature-blocked'
        : 'security-signature-failed',
      details,
    );
  }

  async scanImageForUpdate(
    context: SecurityGateUpdateContext,
    container: SecurityContainer,
    logContainer: SecurityGateLogger,
  ): Promise<VulnerabilityScanResult> {
    logContainer.info(`Running security scan for candidate image ${context.newImage}`);
    const scanResult = await this.scanners.scanImageForVulnerabilities({
      image: context.newImage,
      auth: context.auth,
    });
    await this.persistSecurityState(container, { scan: scanResult }, logContainer, 'update');
    return scanResult;
  }

  async maybeGenerateSbomForUpdate(
    context: SecurityGateUpdateContext,
    container: SecurityContainer,
    logContainer: SecurityGateLogger,
    securityConfiguration: SecurityConfiguration,
  ): Promise<void> {
    if (!securityConfiguration.sbom.enabled) {
      return;
    }

    logContainer.info(`Generating SBOM for candidate image ${context.newImage}`);
    const sbomResult = await this.scanners.generateImageSbom({
      image: context.newImage,
      auth: context.auth,
      formats: securityConfiguration.sbom.formats,
    });
    await this.persistSecurityState(container, { sbom: sbomResult }, logContainer, 'update');

    if (sbomResult.status === 'error') {
      this.telemetry.recordSecurityAudit(
        'security-sbom-failed',
        container,
        'error',
        `SBOM generation failed: ${sbomResult.error || 'unknown SBOM error'}`,
      );
      return;
    }

    this.telemetry.recordSecurityAudit(
      'security-sbom-generated',
      container,
      'success',
      `SBOM generated (${sbomResult.formats.join(', ')})`,
    );
  }

  formatScanSummary(summary: VulnerabilitySummary): string {
    return `critical=${summary.critical}, high=${summary.high}, medium=${summary.medium}, low=${summary.low}, unknown=${summary.unknown}`;
  }

  async maybeEmitHighSeverityAlert(
    container: SecurityContainer,
    scanResult: VulnerabilityScanResult,
    details: string,
  ): Promise<void> {
    const summary = scanResult.summary;
    if (summary.critical === 0 && summary.high === 0) {
      return;
    }

    await this.telemetry.emitSecurityAlert({
      containerName: this.telemetry.fullName(container),
      details,
      status: scanResult.status,
      summary,
      blockingCount: scanResult.blockingCount,
      container,
    });
  }

  throwIfScanFailed(scanResult: VulnerabilityScanResult): void {
    if (scanResult.status !== 'error') {
      return;
    }

    throw this.createSecurityFailure(
      'security-scan-failed',
      `Security scan failed: ${scanResult.error || 'unknown scanner error'}`,
    );
  }

  throwIfScanBlocked(scanResult: VulnerabilityScanResult, details: string): void {
    if (scanResult.status !== 'blocked') {
      return;
    }

    throw this.createSecurityFailure(
      'security-scan-blocked',
      `Security scan blocked update (${scanResult.blockingCount} vulnerabilities matched block severities: ${scanResult.blockSeverities.join(', ')}). Summary: ${details}`,
    );
  }

  async evaluateScanOutcome(
    container: SecurityContainer,
    scanResult: VulnerabilityScanResult,
  ): Promise<void> {
    this.throwIfScanFailed(scanResult);
    const details = this.formatScanSummary(scanResult.summary);
    await this.maybeEmitHighSeverityAlert(container, scanResult, details);
    this.throwIfScanBlocked(scanResult, details);
    this.telemetry.recordSecurityAudit(
      'security-scan-passed',
      container,
      'success',
      `Security scan passed. Summary: ${details}`,
    );
  }

  async maybeScanAndGateUpdate(
    context: SecurityGateUpdateContext,
    container: SecurityContainer,
    logContainer: SecurityGateLogger,
  ): Promise<void> {
    const securityConfiguration = this.securityConfig.getSecurityConfiguration();
    if (!this.shouldRunSecurityGate(securityConfiguration)) {
      return;
    }

    try {
      await this.maybeVerifyImageSignatureForUpdate(
        context,
        container,
        logContainer,
        securityConfiguration,
      );
      const scanResult = await this.scanImageForUpdate(context, container, logContainer);
      await this.maybeGenerateSbomForUpdate(
        context,
        container,
        logContainer,
        securityConfiguration,
      );
      await this.evaluateScanOutcome(container, scanResult);
    } catch (error: unknown) {
      if (TriggerPipelineError.isTriggerPipelineError(error)) {
        this.recordSecurityFailure(container, error as { code: string; message: string });
      }
      throw error;
    }
  }
}

export default SecurityGate;
