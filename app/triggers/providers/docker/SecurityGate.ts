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

const DEFAULT_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

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

type SecurityStatePatchFields = Partial<
  Pick<PersistedSecurityState, 'scan' | 'signature' | 'sbom'>
>;

export type SecurityStatePatch =
  | ({ slot: 'current' } & SecurityStatePatchFields)
  | ({ slot: 'update' } & SecurityStatePatchFields);

type SecurityGateLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

type DockerApiLike = {
  getImage: (name: string) => {
    inspect: () => Promise<{ RepoDigests?: string[] }>;
    remove: () => Promise<void>;
  };
};

type SecurityGateUpdateContext = {
  newImage: string;
  auth: SecurityScannerRequest['auth'];
  dockerApi?: DockerApiLike;
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

type AuthLike = SecurityScannerRequest['auth'];

type ScanImageWithDedupFn = (
  options: { image: string; auth?: AuthLike; digest: string; trivyDbUpdatedAt?: string },
  scanIntervalMs: number,
) => Promise<{ scanResult: VulnerabilityScanResult; fromCache: boolean }>;

type PruneImageFn = (image: string, dockerApi: DockerApiLike | undefined) => Promise<void>;

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
    status: 'success' | 'error' | 'info',
    details: string,
  ) => void;
  // Optional scan-cache short-circuit dependencies
  scanImageWithDedup?: ScanImageWithDedupFn;
  getTrivyDbUpdatedAt?: () => Promise<string | undefined>;
  getScanIntervalMs?: () => number;
  pruneImage?: PruneImageFn;
};

type SecurityGateConstructorOptions = Omit<
  SecurityGateDependencies,
  | 'recordSecurityAudit'
  | 'scanImageWithDedup'
  | 'getTrivyDbUpdatedAt'
  | 'getScanIntervalMs'
  | 'pruneImage'
> & {
  recordSecurityAudit?: SecurityGateDependencies['recordSecurityAudit'];
  scanImageWithDedup?: SecurityGateDependencies['scanImageWithDedup'];
  getTrivyDbUpdatedAt?: SecurityGateDependencies['getTrivyDbUpdatedAt'];
  getScanIntervalMs?: SecurityGateDependencies['getScanIntervalMs'];
  pruneImage?: SecurityGateDependencies['pruneImage'];
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

function mapSecurityStatePatch(securityPatch: SecurityStatePatch): Partial<PersistedSecurityState> {
  const mappedPatch: Partial<PersistedSecurityState> = {};
  const isUpdateSlot = securityPatch.slot === 'update';

  if ('scan' in securityPatch) {
    if (isUpdateSlot) {
      mappedPatch.updateScan = securityPatch.scan;
    } else {
      mappedPatch.scan = securityPatch.scan;
    }
  }
  if ('signature' in securityPatch) {
    if (isUpdateSlot) {
      mappedPatch.updateSignature = securityPatch.signature;
    } else {
      mappedPatch.signature = securityPatch.signature;
    }
  }
  if ('sbom' in securityPatch) {
    if (isUpdateSlot) {
      mappedPatch.updateSbom = securityPatch.sbom;
    } else {
      mappedPatch.sbom = securityPatch.sbom;
    }
  }

  return mappedPatch;
}

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

  scanCache: {
    scanImageWithDedup?: ScanImageWithDedupFn;
    getTrivyDbUpdatedAt?: () => Promise<string | undefined>;
    getScanIntervalMs?: () => number;
    pruneImage?: PruneImageFn;
  };

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
    this.scanCache = {
      scanImageWithDedup: options.scanImageWithDedup,
      getTrivyDbUpdatedAt: options.getTrivyDbUpdatedAt,
      getScanIntervalMs: options.getScanIntervalMs,
      pruneImage: options.pruneImage,
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
  ): Promise<void> {
    try {
      const mappedPatch = mapSecurityStatePatch(securityPatch);
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

  getContainerGateModeOverride(container: SecurityContainer): 'on' | 'off' | undefined {
    const labelRaw = container.labels?.['dd.security.gate'];
    if (typeof labelRaw !== 'string') {
      return undefined;
    }

    const normalised = labelRaw.trim().toLowerCase();
    return normalised === 'on' || normalised === 'off' ? normalised : undefined;
  }

  /**
   * Resolve the effective vulnerability-scan gate mode for this container.
   * Container label `dd.security.gate=on|off` overrides the global
   * `DD_SECURITY_GATE_MODE` setting; unrecognised values fall back to the
   * global default ('on'). When the gate is on, the lifecycle scans first
   * and blocks on configured block-severities. When off, the scan is
   * skipped for this container — the operator has explicitly accepted
   * unscanned updates.
   */
  getEffectiveGateMode(
    container: SecurityContainer,
    securityConfiguration: SecurityConfiguration,
  ): 'on' | 'off' {
    const labelMode = this.getContainerGateModeOverride(container);
    if (labelMode) {
      return labelMode;
    }
    return securityConfiguration.gate?.mode ?? 'on';
  }

  getGateDisabledAuditDetails(
    container: SecurityContainer,
    securityConfiguration: SecurityConfiguration,
  ): string {
    if (this.getContainerGateModeOverride(container) === 'off') {
      return 'Security scan skipped because dd.security.gate=off is set on the container';
    }

    if (securityConfiguration.gate?.mode === 'off') {
      return 'Security scan skipped because DD_SECURITY_GATE_MODE=off is configured globally';
    }

    return 'Security scan skipped because the effective security gate mode is off';
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
      { slot: 'update', signature: signatureResult },
      logContainer,
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

  async resolveImageDigest(
    image: string,
    dockerApi: DockerApiLike | undefined,
  ): Promise<string | undefined> {
    if (!dockerApi) {
      return undefined;
    }
    try {
      const inspected = await dockerApi.getImage(image).inspect();
      const repoDigests = inspected.RepoDigests as string[] | undefined;
      return repoDigests?.[0]?.split('@')[1];
    } catch {
      return undefined;
    }
  }

  async scanImageForUpdate(
    context: SecurityGateUpdateContext,
    container: SecurityContainer,
    logContainer: SecurityGateLogger,
  ): Promise<VulnerabilityScanResult> {
    logContainer.info(`Running security scan for candidate image ${context.newImage}`);

    const { scanImageWithDedup, getTrivyDbUpdatedAt, getScanIntervalMs } = this.scanCache;

    if (scanImageWithDedup) {
      const digest = await this.resolveImageDigest(context.newImage, context.dockerApi);
      if (digest) {
        const trivyDbUpdatedAt = getTrivyDbUpdatedAt ? await getTrivyDbUpdatedAt() : undefined;
        const scanIntervalMs = getScanIntervalMs ? getScanIntervalMs() : DEFAULT_SCAN_INTERVAL_MS;
        const { scanResult, fromCache } = await scanImageWithDedup(
          { image: context.newImage, auth: context.auth, digest, trivyDbUpdatedAt },
          scanIntervalMs,
        );
        if (fromCache) {
          logContainer.info('Using cached scan result');
        }
        await this.persistSecurityState(
          container,
          { slot: 'update', scan: scanResult },
          logContainer,
        );
        return scanResult;
      }
    }

    const scanResult = await this.scanners.scanImageForVulnerabilities({
      image: context.newImage,
      auth: context.auth,
    });
    await this.persistSecurityState(container, { slot: 'update', scan: scanResult }, logContainer);
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
    await this.persistSecurityState(container, { slot: 'update', sbom: sbomResult }, logContainer);

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

  maybeEmitHighSeverityAlert(
    container: SecurityContainer,
    scanResult: VulnerabilityScanResult,
    details: string,
  ): void {
    const summary = scanResult.summary;
    if (summary.critical === 0 && summary.high === 0) {
      return;
    }

    // Fire-and-forget: notification dispatch is owned by the notification
    // outbox layer (with retry/DLQ) — blocking the update lifecycle on
    // sequential notifier delivery is the original v1.5 stall bug.
    void this.telemetry
      .emitSecurityAlert({
        containerName: this.telemetry.fullName(container),
        details,
        status: scanResult.status,
        summary,
        blockingCount: scanResult.blockingCount,
        container,
      })
      .catch(() => undefined);
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
    this.maybeEmitHighSeverityAlert(container, scanResult, details);
    this.throwIfScanBlocked(scanResult, details);
    this.telemetry.recordSecurityAudit(
      'security-scan-passed',
      container,
      'success',
      `Security scan passed. Summary: ${details}`,
    );
  }

  async verifySignaturePreUpdate(
    context: SecurityGateUpdateContext,
    container: SecurityContainer,
    logContainer: SecurityGateLogger,
  ): Promise<void> {
    const securityConfiguration = this.securityConfig.getSecurityConfiguration();
    if (!this.shouldRunSecurityGate(securityConfiguration)) {
      return;
    }
    if (!securityConfiguration.signature.verify) {
      return;
    }
    try {
      await this.maybeVerifyImageSignatureForUpdate(
        context,
        container,
        logContainer,
        securityConfiguration,
      );
    } catch (error: unknown) {
      if (TriggerPipelineError.isTriggerPipelineError(error)) {
        this.recordSecurityFailure(container, error as { code: string; message: string });
      }
      throw error;
    }
  }

  async scanAndGatePostPull(
    context: SecurityGateUpdateContext,
    container: SecurityContainer,
    logContainer: SecurityGateLogger,
    options: { setPhase?: (phase: 'scanning' | 'sbom-generating') => void } = {},
  ): Promise<void> {
    const securityConfiguration = this.securityConfig.getSecurityConfiguration();
    if (!this.shouldRunSecurityGate(securityConfiguration)) {
      return;
    }

    const gateMode = this.getEffectiveGateMode(container, securityConfiguration);
    if (gateMode === 'off') {
      logContainer.info(
        'Security gate disabled for this container (dd.security.gate=off or DD_SECURITY_GATE_MODE=off); skipping scan',
      );
      this.telemetry.recordSecurityAudit(
        'security-scan-skipped',
        container,
        'info',
        this.getGateDisabledAuditDetails(container, securityConfiguration),
      );
      return;
    }

    try {
      options.setPhase?.('scanning');
      const scanResult = await this.scanImageForUpdate(context, container, logContainer);
      if (securityConfiguration.sbom.enabled) {
        options.setPhase?.('sbom-generating');
        await this.maybeGenerateSbomForUpdate(
          context,
          container,
          logContainer,
          securityConfiguration,
        );
      }
      await this.evaluateScanOutcome(container, scanResult);
    } catch (error: unknown) {
      if (TriggerPipelineError.isTriggerPipelineError(error)) {
        this.recordSecurityFailure(container, error as { code: string; message: string });
        if (securityConfiguration.prune?.onBlock) {
          try {
            await this.scanCache.pruneImage?.(context.newImage, context.dockerApi);
          } catch {
            logContainer.warn(`Failed to prune blocked image ${context.newImage}`);
          }
        }
      }
      throw error;
    }
  }

  async maybeScanAndGateUpdate(
    context: SecurityGateUpdateContext,
    container: SecurityContainer,
    logContainer: SecurityGateLogger,
  ): Promise<void> {
    await this.verifySignaturePreUpdate(context, container, logContainer);
    await this.scanAndGatePostPull(context, container, logContainer);
  }
}

export default SecurityGate;
