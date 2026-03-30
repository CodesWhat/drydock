import type { Request, Response } from 'express';
import type { SecurityConfiguration, SecuritySbomFormat } from '../../configuration/index.js';
import type { Container, ContainerSecurityState } from '../../model/container.js';
import {
  getTrivyDatabaseStatus as getTrivyDatabaseStatusDefault,
  type TrivyDatabaseStatus,
} from '../../security/runtime.js';
import type {
  ContainerSecuritySbom,
  ContainerSecurityScan,
  ContainerSignatureVerification,
} from '../../security/scan.js';
import { sendErrorResponse } from '../error-response.js';
import { getPathParamValue } from './request-helpers.js';

interface SecurityStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
  updateContainer: (container: Container) => Container;
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

interface SecurityHandlerDependencies {
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
  getTrivyDatabaseStatus?: () => Promise<TrivyDatabaseStatus | undefined>;
  log: {
    info: (message: string) => void;
  };
}

const MAX_CONCURRENT_ON_DEMAND_SCANS = 1;
const GENERIC_SBOM_ERROR_MESSAGE = 'Error generating SBOM';
const GENERIC_SCAN_ERROR_MESSAGE = 'Security scan failed';

type ResolvedSecurityHandlerContext = Omit<
  SecurityHandlerDependencies,
  'getTrivyDatabaseStatus'
> & {
  getTrivyDatabaseStatus: () => Promise<TrivyDatabaseStatus | undefined>;
};

interface OnDemandScanState {
  inFlightOnDemandScans: number;
}

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

function resolveSbomFormat(
  rawFormat: unknown,
  supportedFormats: readonly SecuritySbomFormat[],
): SecuritySbomFormat | undefined {
  const format = `${rawFormat || 'spdx-json'}`.toLowerCase() as SecuritySbomFormat;
  if (supportedFormats.includes(format)) {
    return format;
  }
  return undefined;
}

/**
 * Get latest vulnerability scan result for a container.
 * @param req
 * @param res
 */
function handleGetContainerVulnerabilities(
  context: ResolvedSecurityHandlerContext,
  req: Request,
  res: Response,
): void {
  const id = getPathParamValue(req.params.id);
  const container = context.storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return;
  }
  if (!container.security?.scan) {
    res.status(200).json(getEmptyVulnerabilityResponse());
    return;
  }
  res.status(200).json(container.security.scan);
}

async function handleGetContainerSbom(
  context: ResolvedSecurityHandlerContext,
  req: Request,
  res: Response,
): Promise<void> {
  const id = getPathParamValue(req.params.id);
  const sbomFormat = resolveSbomFormat(req.query.format, context.SECURITY_SBOM_FORMATS);
  if (!sbomFormat) {
    sendErrorResponse(
      res,
      400,
      `Unsupported SBOM format. Supported values: ${context.SECURITY_SBOM_FORMATS.join(', ')}`,
    );
    return;
  }

  const container = context.storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
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
    const image = context.getContainerImageFullName(container);
    const auth = await context.getContainerRegistryAuth(container);
    const sbomResult = await context.generateImageSbom({
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
    context.storeContainer.updateContainer(containerToStore);

    const generatedDocument = sbomResult.documents?.[sbomFormat];
    if (sbomResult.status !== 'generated' || !generatedDocument) {
      context.log.info(
        `SBOM generation failed for ${image} (${sbomResult.error || 'unknown SBOM error'})`,
      );
      sendErrorResponse(res, 500, GENERIC_SBOM_ERROR_MESSAGE);
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
    context.log.info(`SBOM generation failed (${context.getErrorMessage(error)})`);
    sendErrorResponse(res, 500, GENERIC_SBOM_ERROR_MESSAGE);
  }
}

async function scanCurrentImage(options: {
  context: ResolvedSecurityHandlerContext;
  container: Container;
  securityConfiguration: SecurityConfiguration;
}): Promise<{
  auth: RegistryAuth | undefined;
  scanResult: ContainerSecurityScan;
  securityPatch: Partial<ContainerSecurityState>;
}> {
  const { context, container, securityConfiguration } = options;
  const image = context.getContainerImageFullName(container);
  context.log.info(`Running on-demand security scan for ${image}`);
  const auth = await context.getContainerRegistryAuth(container);
  const scanResult = await context.scanImageForVulnerabilities({ image, auth });
  const securityPatch: Partial<ContainerSecurityState> = { scan: scanResult };

  // Populate the digest scan cache so scheduled scans can benefit
  const containerDigest = container.image?.digest?.value;
  if (context.updateDigestScanCache && containerDigest && scanResult.status !== 'error') {
    const trivyDbStatus = await context.getTrivyDatabaseStatus();
    context.updateDigestScanCache(containerDigest, scanResult, trivyDbStatus?.updatedAt || '');
  }

  const summary = scanResult.summary;
  if (summary && (summary.critical > 0 || summary.high > 0)) {
    const details = `critical=${summary.critical}, high=${summary.high}, medium=${summary.medium}, low=${summary.low}, unknown=${summary.unknown}`;
    await context.emitSecurityAlert({
      containerName: context.fullName(container),
      details,
      status: scanResult.status,
      summary,
      blockingCount: scanResult.blockingCount,
      container,
    });
  }

  if (securityConfiguration.signature.verify) {
    const signatureResult = await context.verifyImageSignature({ image, auth });
    securityPatch.signature = signatureResult;
  }

  if (securityConfiguration.sbom.enabled) {
    const sbomResult = await context.generateImageSbom({
      image,
      auth,
      formats: securityConfiguration.sbom.formats,
    });
    securityPatch.sbom = sbomResult;
  }

  return { auth, scanResult, securityPatch };
}

async function scanUpdateImage(options: {
  context: ResolvedSecurityHandlerContext;
  container: Container;
  securityConfiguration: SecurityConfiguration;
  auth: RegistryAuth | undefined;
  securityPatch: Partial<ContainerSecurityState>;
}): Promise<void> {
  const { context, container, securityConfiguration, auth, securityPatch } = options;

  if (container.updateAvailable && container.result?.tag) {
    try {
      const updateImage = context.getContainerImageFullName(container, container.result.tag);
      context.log.info(`Running on-demand security scan for update image ${updateImage}`);
      const updateScanResult = await context.scanImageForVulnerabilities({
        image: updateImage,
        auth,
      });
      securityPatch.updateScan = updateScanResult;

      if (securityConfiguration.signature.verify) {
        const updateSignatureResult = await context.verifyImageSignature({
          image: updateImage,
          auth,
        });
        securityPatch.updateSignature = updateSignatureResult;
      }

      if (securityConfiguration.sbom.enabled) {
        const updateSbomResult = await context.generateImageSbom({
          image: updateImage,
          auth,
          formats: securityConfiguration.sbom.formats,
        });
        securityPatch.updateSbom = updateSbomResult;
      }
    } catch (updateError: unknown) {
      context.log.info(
        `Update image scan failed (${context.getErrorMessage(updateError)}), current scan preserved`,
      );
    }
    return;
  }

  // Clear stale update data when no update is available
  securityPatch.updateScan = undefined;
  securityPatch.updateSignature = undefined;
  securityPatch.updateSbom = undefined;
}

function persistAndBroadcast(options: {
  context: ResolvedSecurityHandlerContext;
  id: string;
  container: Container;
  securityPatch: Partial<ContainerSecurityState>;
  status: ContainerSecurityScan['status'];
  res: Response;
}): void {
  const { context, id, container, securityPatch, status, res } = options;
  const containerToStore = {
    ...container,
    security: {
      ...(container.security || {}),
      ...securityPatch,
    },
  };
  const updatedContainer = context.storeContainer.updateContainer(containerToStore);

  context.broadcastScanCompleted(id, status);
  res.status(200).json(context.redactContainerRuntimeEnv(updatedContainer));
}

async function handleScanContainer(
  context: ResolvedSecurityHandlerContext,
  scanState: OnDemandScanState,
  req: Request,
  res: Response,
): Promise<void> {
  const id = getPathParamValue(req.params.id);
  const container = context.storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return;
  }

  const securityConfiguration = context.getSecurityConfiguration();
  if (!securityConfiguration.enabled || securityConfiguration.scanner !== 'trivy') {
    sendErrorResponse(res, 400, 'Security scanner is not configured');
    return;
  }

  if (scanState.inFlightOnDemandScans >= MAX_CONCURRENT_ON_DEMAND_SCANS) {
    sendErrorResponse(res, 429, 'Too many concurrent security scans in progress');
    return;
  }

  scanState.inFlightOnDemandScans += 1;
  context.broadcastScanStarted(id);

  try {
    const { auth, scanResult, securityPatch } = await scanCurrentImage({
      context,
      container,
      securityConfiguration,
    });
    await scanUpdateImage({
      context,
      container,
      securityConfiguration,
      auth,
      securityPatch,
    });
    persistAndBroadcast({
      context,
      id,
      container,
      securityPatch,
      status: scanResult.status,
      res,
    });
  } catch (error: unknown) {
    context.log.info(`Security scan failed (${context.getErrorMessage(error)})`);
    context.broadcastScanCompleted(id, 'error');
    sendErrorResponse(res, 500, GENERIC_SCAN_ERROR_MESSAGE);
  } finally {
    scanState.inFlightOnDemandScans = Math.max(0, scanState.inFlightOnDemandScans - 1);
  }
}

export function createSecurityHandlers(dependencies: SecurityHandlerDependencies) {
  const context: ResolvedSecurityHandlerContext = {
    ...dependencies,
    getTrivyDatabaseStatus: dependencies.getTrivyDatabaseStatus ?? getTrivyDatabaseStatusDefault,
  };
  const scanState: OnDemandScanState = {
    inFlightOnDemandScans: 0,
  };

  return {
    getContainerVulnerabilities(req: Request, res: Response) {
      handleGetContainerVulnerabilities(context, req, res);
    },
    getContainerSbom(req: Request, res: Response) {
      return handleGetContainerSbom(context, req, res);
    },
    scanContainer(req: Request, res: Response) {
      return handleScanContainer(context, scanState, req, res);
    },
  };
}
