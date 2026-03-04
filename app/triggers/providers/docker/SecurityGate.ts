import type { SecuritySbomFormat } from '../../../configuration/index.js';
import type { Container } from '../../../model/container.js';
import TriggerPipelineError from './TriggerPipelineError.js';

type SecurityContainer = Container;
type SecurityState = SecurityContainer['security'];

type SecurityConfiguration = {
  enabled: boolean;
  scanner: string;
  signature: {
    verify: boolean;
  };
  sbom: {
    enabled: boolean;
    formats: SecuritySbomFormat[];
  };
};

type SecurityScannerRequest = {
  image: string;
  auth: unknown;
};

type SignatureScanResult = {
  status: string;
  signatures?: number;
  error?: string;
};

type VulnerabilitySummary = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
};

type VulnerabilityScanResult = {
  status: string;
  summary: VulnerabilitySummary;
  blockingCount: number;
  blockSeverities: string[];
  error?: string;
};

type SbomResult = {
  status: string;
  formats: SecuritySbomFormat[];
  error?: string;
};

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

type SecurityGateConstructorOptions = Partial<SecurityGateDependencies> & {
  securityConfig?: Pick<Partial<SecurityGateDependencies>, 'getSecurityConfiguration'>;
  scanners?: Pick<
    Partial<SecurityGateDependencies>,
    'verifyImageSignature' | 'scanImageForVulnerabilities' | 'generateImageSbom'
  >;
  stateStore?: Pick<
    Partial<SecurityGateDependencies>,
    'getContainer' | 'updateContainer' | 'cacheSecurityState'
  >;
  telemetry?: Pick<
    Partial<SecurityGateDependencies>,
    'emitSecurityAlert' | 'fullName' | 'recordSecurityAudit'
  >;
};

class SecurityGate {
  securityConfig: SecurityGateConstructorOptions['securityConfig'];

  scanners: SecurityGateConstructorOptions['scanners'];

  stateStore: SecurityGateConstructorOptions['stateStore'];

  telemetry: SecurityGateConstructorOptions['telemetry'];

  constructor(options: SecurityGateConstructorOptions = {}) {
    this.securityConfig = {
      getSecurityConfiguration:
        options.securityConfig?.getSecurityConfiguration || options.getSecurityConfiguration,
    };
    this.scanners = {
      verifyImageSignature: options.scanners?.verifyImageSignature || options.verifyImageSignature,
      scanImageForVulnerabilities:
        options.scanners?.scanImageForVulnerabilities || options.scanImageForVulnerabilities,
      generateImageSbom: options.scanners?.generateImageSbom || options.generateImageSbom,
    };
    this.stateStore = {
      getContainer: options.stateStore?.getContainer || options.getContainer,
      updateContainer: options.stateStore?.updateContainer || options.updateContainer,
      cacheSecurityState: options.stateStore?.cacheSecurityState || options.cacheSecurityState,
    };
    this.telemetry = {
      emitSecurityAlert: options.telemetry?.emitSecurityAlert || options.emitSecurityAlert,
      fullName: options.telemetry?.fullName || options.fullName,
      recordSecurityAudit:
        options.telemetry?.recordSecurityAudit || options.recordSecurityAudit || (() => undefined),
    };
  }

  createSecurityFailure(code, message) {
    return new TriggerPipelineError(code, message, {
      source: 'SecurityGate',
    });
  }

  getSecurityFailureAuditAction(code) {
    const actionByCode = {
      'security-signature-blocked': 'security-signature-blocked',
      'security-signature-failed': 'security-signature-failed',
      'security-scan-failed': 'security-scan-failed',
      'security-scan-blocked': 'security-scan-blocked',
    };
    return actionByCode[code];
  }

  recordSecurityFailure(container, error) {
    const action = this.getSecurityFailureAuditAction(error.code);
    if (!action) {
      return;
    }
    this.telemetry.recordSecurityAudit(action, container, 'error', error.message);
  }

  async persistSecurityState(
    container,
    securityPatch,
    logContainer,
    slot: 'current' | 'update' = 'current',
  ) {
    try {
      const mappedPatch =
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
    } catch (e: any) {
      logContainer.warn(`Unable to persist security state (${e.message})`);
    }
  }

  async maybeScanAndGateUpdate(context, container, logContainer) {
    const securityConfiguration = this.securityConfig.getSecurityConfiguration();
    if (!securityConfiguration.enabled || securityConfiguration.scanner !== 'trivy') {
      return;
    }

    try {
      if (securityConfiguration.signature.verify) {
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

        if (signatureResult.status !== 'verified') {
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

        this.telemetry.recordSecurityAudit(
          'security-signature-verified',
          container,
          'success',
          `Image signature verified (${signatureResult.signatures} signatures)`,
        );
      }

      logContainer.info(`Running security scan for candidate image ${context.newImage}`);
      const scanResult = await this.scanners.scanImageForVulnerabilities({
        image: context.newImage,
        auth: context.auth,
      });
      await this.persistSecurityState(container, { scan: scanResult }, logContainer, 'update');

      if (securityConfiguration.sbom.enabled) {
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
        } else {
          this.telemetry.recordSecurityAudit(
            'security-sbom-generated',
            container,
            'success',
            `SBOM generated (${sbomResult.formats.join(', ')})`,
          );
        }
      }

      if (scanResult.status === 'error') {
        throw this.createSecurityFailure(
          'security-scan-failed',
          `Security scan failed: ${scanResult.error || 'unknown scanner error'}`,
        );
      }

      const summary = scanResult.summary;
      const details = `critical=${summary.critical}, high=${summary.high}, medium=${summary.medium}, low=${summary.low}, unknown=${summary.unknown}`;

      if (summary.critical > 0 || summary.high > 0) {
        await this.telemetry.emitSecurityAlert({
          containerName: this.telemetry.fullName(container),
          details,
          status: scanResult.status,
          summary,
          blockingCount: scanResult.blockingCount,
          container,
        });
      }

      if (scanResult.status === 'blocked') {
        throw this.createSecurityFailure(
          'security-scan-blocked',
          `Security scan blocked update (${scanResult.blockingCount} vulnerabilities matched block severities: ${scanResult.blockSeverities.join(', ')}). Summary: ${details}`,
        );
      }

      this.telemetry.recordSecurityAudit(
        'security-scan-passed',
        container,
        'success',
        `Security scan passed. Summary: ${details}`,
      );
    } catch (error) {
      if (TriggerPipelineError.isTriggerPipelineError(error)) {
        this.recordSecurityFailure(container, error);
      }
      throw error;
    }
  }
}

export default SecurityGate;
