import type { Request, Response } from 'express';
import type { SecuritySbomFormat } from '../../configuration/index.js';
import type { Container, ContainerSecurityState } from '../../model/container.js';
import type {
  ContainerSecuritySbom,
  ContainerSecurityScan,
  ContainerSignatureVerification,
} from '../../security/scan.js';
import { getPathParamValue } from './request-helpers.js';

interface SecurityStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
  updateContainer: (container: Container) => Container;
}

interface SecurityConfiguration {
  enabled: boolean;
  scanner: string;
  signature: {
    verify: boolean;
  };
  sbom: {
    enabled: boolean;
    formats: SecuritySbomFormat[];
  };
}

interface RegistryAuth {
  username?: string;
  password?: string;
}

interface SecurityAlertPayload {
  containerName: string;
  details: string;
  status?: string;
  summary?: ContainerSecurityScan['summary'];
  blockingCount?: number;
  container?: Container;
}

export interface SecurityHandlerDependencies {
  storeContainer: SecurityStoreContainerApi;
  getSecurityConfiguration: () => SecurityConfiguration;
  SECURITY_SBOM_FORMATS: readonly SecuritySbomFormat[];
  generateImageSbom: (options: {
    image: string;
    auth?: RegistryAuth;
    formats?: SecuritySbomFormat[];
  }) => Promise<ContainerSecuritySbom>;
  scanImageForVulnerabilities: (options: {
    image: string;
    auth?: RegistryAuth;
  }) => Promise<ContainerSecurityScan>;
  verifyImageSignature: (options: {
    image: string;
    auth?: RegistryAuth;
  }) => Promise<ContainerSignatureVerification>;
  emitSecurityAlert: (payload: SecurityAlertPayload) => Promise<void>;
  fullName: (container: Container) => string;
  broadcastScanStarted: (containerId: string) => void;
  broadcastScanCompleted: (containerId: string, status: string) => void;
  redactContainerRuntimeEnv: (container: Container) => Container;
  getErrorMessage: (error: unknown) => string;
  getContainerImageFullName: (container: Container, tagOverride?: string) => string;
  getContainerRegistryAuth: (container: Container) => Promise<RegistryAuth | undefined>;
  updateDigestScanCache?: (
    digest: string,
    scanResult: ContainerSecurityScan,
    trivyDbUpdatedAt: string,
  ) => void;
  log: {
    info: (message: string) => void;
  };
}

export function createSecurityHandlers({
  storeContainer,
  getSecurityConfiguration,
  SECURITY_SBOM_FORMATS,
  generateImageSbom,
  scanImageForVulnerabilities,
  verifyImageSignature,
  emitSecurityAlert,
  fullName,
  broadcastScanStarted,
  broadcastScanCompleted,
  redactContainerRuntimeEnv,
  getErrorMessage,
  getContainerImageFullName,
  getContainerRegistryAuth,
  updateDigestScanCache,
  log,
}: SecurityHandlerDependencies) {
  function getEmptyVulnerabilityResponse() {
    return {
      scanner: undefined,
      scannedAt: undefined,
      status: 'not-scanned',
      blockSeverities: [],
      blockingCount: 0,
      summary: {
        unknown: 0,
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
      vulnerabilities: [],
    };
  }

  function resolveSbomFormat(rawFormat: unknown): SecuritySbomFormat | undefined {
    const format = `${rawFormat || 'spdx-json'}`.toLowerCase() as SecuritySbomFormat;
    if (SECURITY_SBOM_FORMATS.includes(format)) {
      return format;
    }
    return undefined;
  }

  /**
   * Get latest vulnerability scan result for a container.
   * @param req
   * @param res
   */
  function getContainerVulnerabilities(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = storeContainer.getContainer(id);
    if (!container) {
      res.sendStatus(404);
      return;
    }
    if (!container.security?.scan) {
      res.status(200).json(getEmptyVulnerabilityResponse());
      return;
    }
    res.status(200).json(container.security.scan);
  }

  async function getContainerSbom(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const sbomFormat = resolveSbomFormat(req.query.format);
    if (!sbomFormat) {
      res.status(400).json({
        error: `Unsupported SBOM format. Supported values: ${SECURITY_SBOM_FORMATS.join(', ')}`,
      });
      return;
    }

    const container = storeContainer.getContainer(id);
    if (!container) {
      res.sendStatus(404);
      return;
    }

    const existingSbom = container.security?.sbom;
    const existingSbomDocument = existingSbom?.documents?.[sbomFormat];
    if (existingSbom?.status === 'generated' && existingSbomDocument) {
      res.status(200).json({
        generator: existingSbom.generator,
        image: existingSbom.image,
        generatedAt: existingSbom.generatedAt,
        format: sbomFormat,
        document: existingSbomDocument,
        error: existingSbom.error,
      });
      return;
    }

    try {
      const image = getContainerImageFullName(container);
      const auth = await getContainerRegistryAuth(container);
      const sbomResult = await generateImageSbom({
        image,
        auth,
        formats: [sbomFormat],
      });
      const existingSbomState = container.security?.sbom;
      const containerToStore = {
        ...container,
        security: {
          ...(container.security || {}),
          sbom: {
            ...existingSbomState,
            ...sbomResult,
            documents: {
              ...(existingSbomState?.documents || {}),
              ...sbomResult.documents,
            },
          },
        },
      };
      storeContainer.updateContainer(containerToStore);

      const generatedDocument = sbomResult.documents?.[sbomFormat];
      if (sbomResult.status !== 'generated' || !generatedDocument) {
        res.status(500).json({
          error: `Error generating SBOM (${sbomResult.error || 'unknown SBOM error'})`,
        });
        return;
      }

      res.status(200).json({
        generator: sbomResult.generator,
        image: sbomResult.image,
        generatedAt: sbomResult.generatedAt,
        format: sbomFormat,
        document: generatedDocument,
        error: sbomResult.error,
      });
    } catch (error: unknown) {
      res.status(500).json({
        error: `Error generating SBOM (${getErrorMessage(error)})`,
      });
    }
  }

  async function scanContainer(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = storeContainer.getContainer(id);
    if (!container) {
      res.sendStatus(404);
      return;
    }

    const securityConfiguration = getSecurityConfiguration();
    if (!securityConfiguration.enabled || securityConfiguration.scanner !== 'trivy') {
      res.status(400).json({ error: 'Security scanner is not configured' });
      return;
    }

    broadcastScanStarted(id);

    try {
      const image = getContainerImageFullName(container);
      log.info(`Running on-demand security scan for ${image}`);
      const auth = await getContainerRegistryAuth(container);
      const securityPatch: Partial<ContainerSecurityState> = {};

      // Run vulnerability scan
      const scanResult = await scanImageForVulnerabilities({ image, auth });
      securityPatch.scan = scanResult;

      // Populate the digest scan cache so scheduled scans can benefit
      const containerDigest = container.image?.digest?.value;
      if (updateDigestScanCache && containerDigest && scanResult.status !== 'error') {
        updateDigestScanCache(containerDigest, scanResult, '');
      }

      const summary = scanResult.summary;
      if (summary && (summary.critical > 0 || summary.high > 0)) {
        const details = `critical=${summary.critical}, high=${summary.high}, medium=${summary.medium}, low=${summary.low}, unknown=${summary.unknown}`;
        await emitSecurityAlert({
          containerName: fullName(container),
          details,
          status: scanResult.status,
          summary,
          blockingCount: scanResult.blockingCount,
          container,
        });
      }

      // Run signature verification if configured
      if (securityConfiguration.signature.verify) {
        const signatureResult = await verifyImageSignature({ image, auth });
        securityPatch.signature = signatureResult;
      }

      // Generate SBOM if configured
      if (securityConfiguration.sbom.enabled) {
        const sbomResult = await generateImageSbom({
          image,
          auth,
          formats: securityConfiguration.sbom.formats,
        });
        securityPatch.sbom = sbomResult;
      }

      // Scan update image when an update is available
      if (container.updateAvailable && container.result?.tag) {
        try {
          const updateImage = getContainerImageFullName(container, container.result.tag);
          log.info(`Running on-demand security scan for update image ${updateImage}`);
          const updateScanResult = await scanImageForVulnerabilities({
            image: updateImage,
            auth,
          });
          securityPatch.updateScan = updateScanResult;

          if (securityConfiguration.signature.verify) {
            const updateSignatureResult = await verifyImageSignature({
              image: updateImage,
              auth,
            });
            securityPatch.updateSignature = updateSignatureResult;
          }

          if (securityConfiguration.sbom.enabled) {
            const updateSbomResult = await generateImageSbom({
              image: updateImage,
              auth,
              formats: securityConfiguration.sbom.formats,
            });
            securityPatch.updateSbom = updateSbomResult;
          }
        } catch (updateError: unknown) {
          log.info(
            `Update image scan failed (${getErrorMessage(updateError)}), current scan preserved`,
          );
        }
      } else {
        // Clear stale update data when no update is available
        securityPatch.updateScan = undefined;
        securityPatch.updateSignature = undefined;
        securityPatch.updateSbom = undefined;
      }

      // Persist results
      const containerToStore = {
        ...container,
        security: {
          ...(container.security || {}),
          ...securityPatch,
        },
      };
      const updatedContainer = storeContainer.updateContainer(containerToStore);

      broadcastScanCompleted(id, scanResult.status);
      res.status(200).json(redactContainerRuntimeEnv(updatedContainer));
    } catch (error: unknown) {
      broadcastScanCompleted(id, 'error');
      res.status(500).json({
        error: `Security scan failed (${getErrorMessage(error)})`,
      });
    }
  }

  return {
    getContainerVulnerabilities,
    getContainerSbom,
    scanContainer,
  };
}
