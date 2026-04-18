import type { Request, Response } from 'express';
import type { SecurityConfiguration } from '../../configuration/index.js';
import type { SecurityScanCycleCompleteEventPayload } from '../../event/index.js';
import type { Container } from '../../model/container.js';
import type { ContainerSecurityScan } from '../../security/scan.js';
import { uuidv7 } from '../../util/uuid.js';
import { sendErrorResponse } from '../error-response.js';

export const MAX_CONCURRENT_BULK_SCANS = 4;

const VALID_SEVERITY_VALUES = ['critical', 'high', 'all'] as const;
type SeverityFilter = (typeof VALID_SEVERITY_VALUES)[number];

interface BulkSecurityAlertPayload {
  containerName: string;
  details: string;
  status?: string;
  summary?: ContainerSecurityScan['summary'];
  blockingCount?: number;
  container?: Container;
  cycleId?: string;
}

interface BulkSecurityStoreApi {
  getAllContainers: () => Container[];
  getContainer: (id: string) => Container | undefined;
}

interface BulkSecurityHandlerDependencies {
  storeContainer: BulkSecurityStoreApi;
  getSecurityConfiguration: () => SecurityConfiguration;
  scanImageForVulnerabilities: (options: {
    image: string;
    auth?: { username?: string; password?: string };
  }) => Promise<ContainerSecurityScan>;
  emitSecurityAlert: (payload: BulkSecurityAlertPayload) => Promise<void>;
  emitSecurityScanCycleComplete: (payload: SecurityScanCycleCompleteEventPayload) => Promise<void>;
  fullName: (container: Container) => string;
  broadcastScanStarted: (containerId: string) => void;
  broadcastScanCompleted: (containerId: string, status: string) => void;
  getContainerImageFullName: (container: Container) => string;
  getContainerRegistryAuth: (
    container: Container,
  ) => Promise<{ username?: string; password?: string } | undefined>;
  getErrorMessage: (error: unknown) => string;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
}

interface ParsedBulkScanBody {
  containerIds?: string[];
  severity?: SeverityFilter;
}

function parseBulkScanBody(
  body: unknown,
): { parsed: ParsedBulkScanBody } | { error: string; status: 400 } {
  if (body === null || body === undefined || (typeof body === 'object' && !Array.isArray(body))) {
    const parsed: ParsedBulkScanBody = {};
    if (!body || typeof body !== 'object') {
      return { parsed };
    }
    const requestBody = body as Record<string, unknown>;
    const allowedKeys = new Set(['containerIds', 'severity']);
    const unknownKeys = Object.keys(requestBody).filter((k) => !allowedKeys.has(k));
    if (unknownKeys.length > 0) {
      return { error: `Unknown request properties: ${unknownKeys.join(', ')}`, status: 400 };
    }

    // Validate containerIds
    if (requestBody.containerIds !== undefined) {
      if (!Array.isArray(requestBody.containerIds)) {
        return { error: 'containerIds must be an array of strings', status: 400 };
      }
      const normalized: string[] = [];
      for (const id of requestBody.containerIds) {
        if (typeof id !== 'string' || id.trim() === '') {
          return { error: 'containerIds must be an array of non-empty strings', status: 400 };
        }
        normalized.push(id.trim());
      }
      parsed.containerIds = normalized;
    }

    // Validate severity
    if (requestBody.severity !== undefined) {
      if (!VALID_SEVERITY_VALUES.includes(requestBody.severity as SeverityFilter)) {
        return {
          error: `severity must be one of: ${VALID_SEVERITY_VALUES.join(', ')}`,
          status: 400,
        };
      }
      parsed.severity = requestBody.severity as SeverityFilter;
    }

    return { parsed };
  }

  return { error: 'Request body must be a JSON object', status: 400 };
}

function shouldEmitAlert(
  summary: ContainerSecurityScan['summary'] | undefined,
  severity: SeverityFilter,
): boolean {
  if (!summary) return false;
  if (severity === 'critical') {
    return summary.critical > 0;
  }
  // 'high' and 'all' both use the standard threshold
  return summary.critical > 0 || summary.high > 0;
}

async function runConcurrently<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const iterator = items[Symbol.iterator]();
  let done = false;

  async function worker(): Promise<void> {
    while (!done) {
      if (signal?.aborted) {
        done = true;
        return;
      }
      const next = iterator.next();
      if (next.done) {
        done = true;
        return;
      }
      await fn(next.value);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
}

async function runBulkScan(
  deps: BulkSecurityHandlerDependencies,
  containers: Container[],
  cycleId: string,
  startedAt: string,
  severity: SeverityFilter,
  signal?: AbortSignal,
): Promise<void> {
  let alertCount = 0;
  let scannedCount = 0;

  try {
    await runConcurrently(
      containers,
      MAX_CONCURRENT_BULK_SCANS,
      async (container) => {
        const containerId = container.id;
        deps.broadcastScanStarted(containerId);
        try {
          const image = deps.getContainerImageFullName(container);
          const auth = await deps.getContainerRegistryAuth(container);
          const scanResult = await deps.scanImageForVulnerabilities({ image, auth });
          scannedCount += 1;

          if (shouldEmitAlert(scanResult.summary, severity)) {
            const s = scanResult.summary!;
            const details = `critical=${s.critical}, high=${s.high}, medium=${s.medium}, low=${s.low}, unknown=${s.unknown}`;
            await deps.emitSecurityAlert({
              containerName: deps.fullName(container),
              details,
              status: scanResult.status,
              summary: s,
              blockingCount: scanResult.blockingCount,
              container,
              cycleId,
            });
            alertCount += 1;
          }

          deps.broadcastScanCompleted(containerId, scanResult.status);
        } catch (err: unknown) {
          scannedCount += 1;
          deps.log.info(
            `Bulk scan failed for container ${containerId} (${deps.getErrorMessage(err)})`,
          );
          deps.broadcastScanCompleted(containerId, 'error');
        }
      },
      signal,
    );
  } finally {
    const completedAt = new Date().toISOString();
    await deps.emitSecurityScanCycleComplete({
      cycleId,
      scannedCount,
      alertCount,
      scope: 'on-demand-bulk',
      startedAt,
      completedAt,
    });
  }
}

export function createBulkSecurityHandlers(deps: BulkSecurityHandlerDependencies) {
  return {
    async scanAll(req: Request, res: Response): Promise<void> {
      const securityConfiguration = deps.getSecurityConfiguration();
      if (!securityConfiguration.enabled || securityConfiguration.scanner !== 'trivy') {
        sendErrorResponse(res, 400, 'Security scanner is not configured');
        return;
      }

      const parseResult = parseBulkScanBody(req.body);
      if ('error' in parseResult) {
        sendErrorResponse(res, parseResult.status, parseResult.error);
        return;
      }

      const { containerIds, severity = 'all' } = parseResult.parsed;

      // Resolve container set server-side
      let targetContainers: Container[];
      if (containerIds !== undefined && containerIds.length > 0) {
        const resolved: Container[] = [];
        for (const id of containerIds) {
          const container = deps.storeContainer.getContainer(id);
          if (!container) {
            sendErrorResponse(res, 400, `Unknown container id: ${id}`);
            return;
          }
          resolved.push(container);
        }
        targetContainers = resolved;
      } else {
        targetContainers = deps.storeContainer.getAllContainers();
      }

      const cycleId = uuidv7();
      const startedAt = new Date().toISOString();

      // Build AbortSignal tied to client disconnect
      const abortController = new AbortController();
      req.on('close', () => {
        abortController.abort();
      });

      // Respond immediately with 202 — work continues async
      res.status(202).json({ cycleId, scheduledCount: targetContainers.length });

      // Run async, don't let unhandled rejections crash the process
      runBulkScan(
        deps,
        targetContainers,
        cycleId,
        startedAt,
        severity,
        abortController.signal,
      ).catch((err: unknown) => {
        deps.log.error(`Bulk scan cycle ${cycleId} failed: ${deps.getErrorMessage(err)}`);
      });
    },
  };
}
