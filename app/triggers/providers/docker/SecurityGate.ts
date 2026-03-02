// @ts-nocheck
import TriggerPipelineError from './TriggerPipelineError.js';

class SecurityGate {
  securityConfig;

  scanners;

  stateStore;

  telemetry;

  constructor(options = {}) {
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

  async persistSecurityState(container, securityPatch, logContainer) {
    try {
      const containerCurrent = this.stateStore.getContainer(container.id);
      const containerWithSecurity = {
        ...(containerCurrent || container),
        security: {
          ...((containerCurrent || container).security || {}),
          ...securityPatch,
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
        await this.persistSecurityState(container, { signature: signatureResult }, logContainer);

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
      await this.persistSecurityState(container, { scan: scanResult }, logContainer);

      if (securityConfiguration.sbom.enabled) {
        logContainer.info(`Generating SBOM for candidate image ${context.newImage}`);
        const sbomResult = await this.scanners.generateImageSbom({
          image: context.newImage,
          auth: context.auth,
          formats: securityConfiguration.sbom.formats,
        });
        await this.persistSecurityState(container, { sbom: sbomResult }, logContainer);

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
