import { extractCollectionData } from '../utils/api';
import type { ApiContainerInput } from '../utils/container-mapper';
import { ApiError, errorMessage } from '../utils/error';

interface ContainerGroupMember {
  id: string;
  name: string;
  displayName: string;
  updateAvailable: boolean;
}

interface ContainerGroup {
  name: string | null;
  containers: ContainerGroupMember[];
  containerCount: number;
  updatesAvailable: number;
}

interface ContainerSummary {
  containers: {
    total: number;
    running: number;
    stopped: number;
  };
  security: {
    issues: number;
  };
}

type ContainerRecentStatus = 'updated' | 'pending' | 'failed';

interface ContainerRecentStatusResponse {
  statuses: Record<string, ContainerRecentStatus>;
}

interface GetAllContainersOptions {
  includeVulnerabilities?: boolean;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

interface AggregatedSecuritySummary {
  unknown: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

interface AggregatedSecurityVulnerability {
  id: string;
  severity: string;
  package: string;
  version: string;
  fixedIn: string | null;
  title: string;
  target: string;
  primaryUrl: string;
  publishedDate: string;
}

interface AggregatedSecurityImage {
  image: string;
  containerIds: string[];
  updateSummary?: AggregatedSecuritySummary;
  vulnerabilities: AggregatedSecurityVulnerability[];
}

interface SecurityVulnerabilityOverview {
  totalContainers: number;
  scannedContainers: number;
  latestScannedAt: string | null;
  images: AggregatedSecurityImage[];
}

interface ContainerTriggerRequest {
  containerId: string;
  triggerType: string;
  triggerName: string;
  triggerAgent?: string;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof (value as AbortSignal).addEventListener === 'function'
  );
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function toNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

function buildContainerQueryString(options: GetAllContainersOptions): string {
  const query = new URLSearchParams();
  if (options.includeVulnerabilities) {
    query.set('includeVulnerabilities', 'true');
  }
  const limit = toPositiveInteger(options.limit);
  if (limit !== undefined) {
    query.set('limit', `${limit}`);
  }
  const offset = toNonNegativeInteger(options.offset);
  if (offset !== undefined) {
    query.set('offset', `${offset}`);
  }
  const queryString = query.toString();
  return queryString.length > 0 ? `?${queryString}` : '';
}

async function getAllContainers(
  optionsOrSignal: GetAllContainersOptions | AbortSignal = {},
): Promise<ApiContainerInput[]> {
  const options = isAbortSignal(optionsOrSignal) ? { signal: optionsOrSignal } : optionsOrSignal;
  const response = await fetch(`/api/v1/containers${buildContainerQueryString(options)}`, {
    credentials: 'include',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to get containers: ${response.statusText}`);
  }
  const payload = await response.json();
  return extractCollectionData<ApiContainerInput>(payload);
}

async function getContainerSummary(): Promise<ContainerSummary> {
  const response = await fetch('/api/v1/containers/summary', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get container summary: ${response.statusText}`);
  }
  return response.json();
}

async function getContainerRecentStatus(): Promise<ContainerRecentStatusResponse> {
  const response = await fetch('/api/v1/containers/recent-status', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get container recent status: ${response.statusText}`);
  }
  return response.json();
}

async function refreshAllContainers() {
  const response = await fetch(`/api/v1/containers/watch`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to refresh all containers: ${response.statusText}`);
  }
  return response.json();
}

async function refreshContainer(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/watch`, {
    method: 'POST',
    credentials: 'include',
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Failed to refresh container ${containerId}: ${response.statusText}`);
  }
  return response.json();
}

async function deleteContainer(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'X-DD-Confirm-Action': 'container-delete',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to delete container ${containerId}: ${response.statusText}`);
  }
  return response;
}

async function getContainerTriggers(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/triggers`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get triggers for container ${containerId}: ${response.statusText}`);
  }
  const payload = await response.json();
  return extractCollectionData<Record<string, unknown>>(payload);
}

async function runTrigger({
  containerId,
  triggerType,
  triggerName,
  triggerAgent,
}: ContainerTriggerRequest) {
  const url = triggerAgent
    ? `/api/v1/containers/${containerId}/triggers/${triggerType}/${triggerName}/${triggerAgent}`
    : `/api/v1/containers/${containerId}/triggers/${triggerType}/${triggerName}`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to run trigger ${triggerType}/${triggerName}: ${response.statusText}`);
  }
  return response.json();
}

async function getContainerLogs(containerId: string, tail: number = 100) {
  const response = await fetch(`/api/v1/containers/${containerId}/logs?tail=${tail}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get logs for container ${containerId}: ${response.statusText}`);
  }
  return response.json();
}

async function getContainerUpdateOperations(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/update-operations`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(
      `Failed to get update operations for container ${containerId}: ${response.statusText}`,
    );
  }
  const payload = await response.json();
  return extractCollectionData<Record<string, unknown>>(payload);
}

async function getContainerVulnerabilities(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/vulnerabilities`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(
      `Failed to get vulnerabilities for container ${containerId}: ${response.statusText}`,
    );
  }
  return response.json();
}

async function getSecurityVulnerabilityOverview(): Promise<SecurityVulnerabilityOverview> {
  const response = await fetch('/api/v1/containers/security/vulnerabilities', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get aggregated vulnerabilities: ${response.statusText}`);
  }
  return response.json();
}

async function getContainerSbom(containerId: string, format: string = 'spdx-json') {
  const response = await fetch(
    `/api/v1/containers/${containerId}/sbom?format=${encodeURIComponent(format)}`,
    {
      credentials: 'include',
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to get SBOM for container ${containerId}: ${response.statusText}`);
  }
  return response.json();
}

async function updateContainerPolicy(
  containerId: string,
  action: string,
  payload: Record<string, unknown> = {},
) {
  const response = await fetch(`/api/v1/containers/${containerId}/update-policy`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      ...payload,
    }),
  });
  if (!response.ok) {
    let details = '';
    try {
      const body = await response.json();
      details = body?.error ? ` (${body.error})` : '';
    } catch (e: unknown) {
      console.debug(`Unable to parse policy update response payload: ${errorMessage(e)}`);
      // Ignore parsing error and fallback to status text.
    }
    throw new Error(
      `Failed to update container policy ${action}: ${response.statusText}${details}`,
    );
  }
  return response.json();
}

async function getContainerGroups(): Promise<ContainerGroup[]> {
  const response = await fetch('/api/v1/containers/groups', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get container groups: ${response.statusText}`);
  }
  const payload = await response.json();
  return extractCollectionData<ContainerGroup>(payload);
}

async function scanContainer(containerId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/v1/containers/${containerId}/scan`, {
    method: 'POST',
    credentials: 'include',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    let details = '';
    try {
      const body = await response.json();
      details = body?.error ? ` (${body.error})` : '';
    } catch (e: unknown) {
      console.debug(`Unable to parse scan response payload: ${errorMessage(e)}`);
    }
    throw new ApiError(
      `Failed to scan container: ${response.statusText}${details}`,
      response.status,
    );
  }
  return response.json();
}

async function getContainerReleaseNotes(containerId: string) {
  const response = await fetch(`/api/containers/${containerId}/release-notes`, {
    credentials: 'include',
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to get release notes for container ${containerId}: ${response.statusText}`,
    );
  }
  return response.json();
}

async function revealContainerEnv(containerId: string) {
  const response = await fetch(`/api/v1/containers/${containerId}/env/reveal`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to reveal env vars: ${response.statusText}`);
  }
  return response.json();
}

export type { ContainerGroup };
export {
  deleteContainer,
  getAllContainers,
  getContainerGroups,
  getContainerLogs,
  getContainerRecentStatus,
  getContainerReleaseNotes,
  getContainerSbom,
  getContainerSummary,
  getContainerTriggers,
  getContainerUpdateOperations,
  getContainerVulnerabilities,
  getSecurityVulnerabilityOverview,
  refreshAllContainers,
  refreshContainer,
  revealContainerEnv,
  runTrigger,
  scanContainer,
  updateContainerPolicy,
};
