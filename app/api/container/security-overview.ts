import type { Request } from 'express';
import type { Container } from '../../model/container.js';
import { buildPaginationLinks, type PaginationLinks } from '../pagination-links.js';
import { normalizeLimitOffsetPagination } from './request-helpers.js';

interface ContainerListPagination {
  limit: number;
  offset: number;
}

export interface ContainerSecuritySummary {
  unknown: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface SecurityViewVulnerability {
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

export interface SecurityImageVulnerabilityGroup {
  image: string;
  containerIds: string[];
  updateSummary?: ContainerSecuritySummary;
  vulnerabilities: SecurityViewVulnerability[];
}

interface FlattenedSecurityVulnerability {
  image: string;
  vulnerability: SecurityViewVulnerability;
}

interface AppendedContainerScanData {
  scannedAt: string;
}

interface SecurityVulnerabilityPage {
  total: number;
  pagination: ContainerListPagination;
  hasMore: boolean;
  links?: PaginationLinks;
  pagedImages: SecurityImageVulnerabilityGroup[];
}

export interface SecurityVulnerabilityOverviewResponse {
  totalContainers: number;
  scannedContainers: number;
  latestScannedAt: string | null;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  _links?: PaginationLinks;
  images: SecurityImageVulnerabilityGroup[];
}

const SECURITY_VULNERABILITY_MAX_LIMIT = 200;

function normalizeSecurityOverviewPagination(query: Request['query']) {
  return normalizeLimitOffsetPagination(query, { maxLimit: SECURITY_VULNERABILITY_MAX_LIMIT });
}

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function chooseLatestScannedAt(current: string | null, candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return current;
  }
  if (current === null) {
    return candidate;
  }
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  if (Number.isFinite(currentTime) && Number.isFinite(candidateTime)) {
    return candidateTime > currentTime ? candidate : current;
  }
  return candidate > current ? candidate : current;
}

function readStringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readVulnerabilityString(vulnerability: unknown, fields: string[], fallback = ''): string {
  if (!vulnerability || typeof vulnerability !== 'object') {
    return fallback;
  }
  const record = vulnerability as Record<string, unknown>;
  for (const field of fields) {
    const value = readStringField(record[field]);
    if (value !== undefined) {
      return value;
    }
  }
  return fallback;
}

function readVulnerabilityFixedIn(vulnerability: unknown): string | null {
  const fixedIn = readVulnerabilityString(vulnerability, ['fixedVersion', 'fixedIn']);
  return fixedIn.length > 0 ? fixedIn : null;
}

function normalizeUpdateSummary(summary: unknown): ContainerSecuritySummary {
  const record = summary && typeof summary === 'object' ? (summary as Record<string, unknown>) : {};
  return {
    unknown: toNonNegativeInteger(record.unknown),
    low: toNonNegativeInteger(record.low),
    medium: toNonNegativeInteger(record.medium),
    high: toNonNegativeInteger(record.high),
    critical: toNonNegativeInteger(record.critical),
  };
}

function normalizeSecurityVulnerability(vulnerability: unknown): SecurityViewVulnerability {
  return {
    id: readVulnerabilityString(vulnerability, ['id'], 'unknown'),
    severity: readVulnerabilityString(vulnerability, ['severity'], 'UNKNOWN'),
    package: readVulnerabilityString(vulnerability, ['packageName', 'package'], 'unknown'),
    version: readVulnerabilityString(vulnerability, ['installedVersion', 'version'], ''),
    fixedIn: readVulnerabilityFixedIn(vulnerability),
    title: readVulnerabilityString(vulnerability, ['title', 'Title'], ''),
    target: readVulnerabilityString(vulnerability, ['target', 'Target'], ''),
    primaryUrl: readVulnerabilityString(vulnerability, ['primaryUrl', 'PrimaryURL'], ''),
    publishedDate: readVulnerabilityString(vulnerability, ['publishedDate'], ''),
  };
}

function resolveSecurityImageName(container: Container): string {
  const displayName = readStringField(container.displayName)?.trim();
  if (displayName) {
    return displayName;
  }
  const name = readStringField(container.name)?.trim();
  if (name) {
    return name;
  }
  return 'unknown';
}

function paginateFlattenedVulnerabilities(
  vulnerabilities: FlattenedSecurityVulnerability[],
  pagination: ContainerListPagination,
): FlattenedSecurityVulnerability[] {
  if (pagination.limit === 0 && pagination.offset === 0) {
    return vulnerabilities;
  }
  if (pagination.limit === 0) {
    return vulnerabilities.slice(pagination.offset);
  }
  return vulnerabilities.slice(pagination.offset, pagination.offset + pagination.limit);
}

function appendContainerScanData(
  images: Map<string, SecurityImageVulnerabilityGroup>,
  flattenedVulnerabilities: FlattenedSecurityVulnerability[],
  container: Container,
): AppendedContainerScanData | undefined {
  const scan = container.security?.scan;
  if (!scan) {
    return undefined;
  }

  const image = resolveSecurityImageName(container);
  const existingGroup = images.get(image) || {
    image,
    containerIds: [],
    vulnerabilities: [],
  };

  if (
    typeof container.id === 'string' &&
    container.id.length > 0 &&
    !existingGroup.containerIds.includes(container.id)
  ) {
    existingGroup.containerIds.push(container.id);
  }

  const updateSummary = container.security?.updateScan?.summary;
  if (updateSummary) {
    existingGroup.updateSummary = normalizeUpdateSummary(updateSummary);
  }

  const vulnerabilityList = Array.isArray(scan.vulnerabilities) ? scan.vulnerabilities : [];
  for (const vulnerability of vulnerabilityList) {
    const normalizedVulnerability = normalizeSecurityVulnerability(vulnerability);
    existingGroup.vulnerabilities.push(normalizedVulnerability);
    flattenedVulnerabilities.push({
      image,
      vulnerability: normalizedVulnerability,
    });
  }

  images.set(image, existingGroup);
  return {
    scannedAt: scan.scannedAt,
  };
}

function collectSecurityVulnerabilityData(containers: Container[]) {
  const images = new Map<string, SecurityImageVulnerabilityGroup>();
  const flattenedVulnerabilities: FlattenedSecurityVulnerability[] = [];
  let scannedContainers = 0;
  let latestScannedAt: string | null = null;

  for (const container of containers) {
    const scanData = appendContainerScanData(images, flattenedVulnerabilities, container);
    if (!scanData) {
      continue;
    }
    scannedContainers += 1;
    latestScannedAt = chooseLatestScannedAt(latestScannedAt, scanData.scannedAt);
  }

  return {
    allImageGroups: [...images.values()],
    flattenedVulnerabilities,
    scannedContainers,
    latestScannedAt,
  };
}

function buildPaginatedImageGroups(
  allImageGroups: SecurityImageVulnerabilityGroup[],
  pagedVulnerabilities: FlattenedSecurityVulnerability[],
): SecurityImageVulnerabilityGroup[] {
  const groupedImages = new Map<string, SecurityImageVulnerabilityGroup>();
  const imageTemplates = new Map(allImageGroups.map((group) => [group.image, group] as const));
  for (const { image, vulnerability } of pagedVulnerabilities) {
    const template = imageTemplates.get(image);
    if (!template) {
      continue;
    }
    let group = groupedImages.get(image);
    if (!group) {
      group = {
        image: template.image,
        containerIds: [...template.containerIds],
        vulnerabilities: [],
        ...(template.updateSummary ? { updateSummary: template.updateSummary } : {}),
      };
      groupedImages.set(image, group);
    }
    group.vulnerabilities.push(vulnerability);
  }
  return [...groupedImages.values()];
}

function buildSecurityVulnerabilityPage(
  query: Request['query'],
  allImageGroups: SecurityImageVulnerabilityGroup[],
  flattenedVulnerabilities: FlattenedSecurityVulnerability[],
): SecurityVulnerabilityPage {
  const pagination = normalizeSecurityOverviewPagination(query);
  const pagedVulnerabilities = paginateFlattenedVulnerabilities(
    flattenedVulnerabilities,
    pagination,
  );
  const total = flattenedVulnerabilities.length;
  const hasMore = pagination.limit > 0 && pagination.offset + pagedVulnerabilities.length < total;
  const links = buildPaginationLinks({
    basePath: '/api/containers/security/vulnerabilities',
    query,
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    returnedCount: pagedVulnerabilities.length,
  });
  const isPaginated = pagination.limit > 0 || pagination.offset > 0;
  const pagedImages = isPaginated
    ? buildPaginatedImageGroups(allImageGroups, pagedVulnerabilities)
    : allImageGroups;
  return {
    total,
    pagination,
    hasMore,
    ...(links ? { links } : {}),
    pagedImages,
  };
}

export function buildSecurityVulnerabilityOverviewResponse(
  containers: Container[],
  query: Request['query'],
  totalContainerCount?: number,
): SecurityVulnerabilityOverviewResponse {
  const { allImageGroups, flattenedVulnerabilities, scannedContainers, latestScannedAt } =
    collectSecurityVulnerabilityData(containers);
  const { total, pagination, hasMore, links, pagedImages } = buildSecurityVulnerabilityPage(
    query,
    allImageGroups,
    flattenedVulnerabilities,
  );
  const totalContainers =
    typeof totalContainerCount === 'number' && Number.isFinite(totalContainerCount)
      ? Math.max(0, Math.trunc(totalContainerCount))
      : containers.length;
  return {
    totalContainers,
    scannedContainers,
    latestScannedAt,
    total,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore,
    ...(links ? { _links: links } : {}),
    images: pagedImages,
  };
}
