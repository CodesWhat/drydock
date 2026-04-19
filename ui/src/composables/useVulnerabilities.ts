import { computed, type Ref, ref } from 'vue';
import { getSecurityVulnerabilityOverview } from '../services/container';
import type {
  Container,
  ContainerReleaseNotes,
  ContainerSecurityDelta,
  ContainerSecuritySummary,
} from '../types/container';
import { computeSecurityDelta } from '../utils/container-mapper';
import { errorMessage } from '../utils/error';
import { normalizeSeverity } from '../utils/security';
import type { Vulnerability } from '../views/security/securityViewTypes';
import {
  chooseLatestTimestamp,
  normalizeSeverityCount,
  severityOrder,
} from '../views/security/securityViewUtils';

export type { Vulnerability } from '../views/security/securityViewTypes';

export interface ImageSummary {
  image: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  total: number;
  fixable: number;
  delta?: ContainerSecurityDelta;
  hasUpdate?: boolean;
  containersWithUpdate?: string[];
  releaseNotes?: ContainerReleaseNotes | null;
  releaseLink?: string;
}

export interface ImageSummaryWithVulns extends ImageSummary {
  vulns: Vulnerability[];
}

const securitySortFields = [
  'image',
  'critical',
  'high',
  'medium',
  'low',
  'fixable',
  'total',
] as const;

type SecuritySortField = (typeof securitySortFields)[number];
type SecurityNumericSortField = Exclude<SecuritySortField, 'image'>;

function isSecuritySortField(value: string): value is SecuritySortField {
  return (securitySortFields as readonly string[]).includes(value);
}

function normalizeSecuritySortField(value: string): SecuritySortField {
  return isSecuritySortField(value) ? value : 'critical';
}

function readNumericSortValue(summary: ImageSummary, field: SecurityNumericSortField): number {
  switch (field) {
    case 'critical':
      return summary.critical;
    case 'high':
      return summary.high;
    case 'medium':
      return summary.medium;
    case 'low':
      return summary.low;
    case 'fixable':
      return summary.fixable;
    case 'total':
      return summary.total;
  }
}

interface UseVulnerabilitiesOptions {
  securitySortField: Ref<string>;
  securitySortAsc: Ref<boolean>;
  containers?: Ref<Container[]>;
}

interface UpdateScanSummary extends ContainerSecuritySummary {}

type VulnerabilityOverview = Awaited<ReturnType<typeof getSecurityVulnerabilityOverview>>;
type VulnerabilityOverviewImage = VulnerabilityOverview['images'][number];

type ParsedOverviewVulnerabilities = {
  vulnerabilities: Vulnerability[];
  imageContainerMap: Record<string, string[]>;
  updateSummaryMap: Record<string, UpdateScanSummary>;
  latestScanAt: string | null;
};

interface VulnerabilityStateRefs {
  securityVulnerabilities: Ref<Vulnerability[]>;
  containerIdsByImage: Ref<Record<string, string[]>>;
  updateScanSummaries: Ref<Record<string, UpdateScanSummary>>;
  latestSecurityScanAt: Ref<string | null>;
  totalContainerCount: Ref<number>;
  scannedContainerCount: Ref<number>;
}

interface FetchVulnerabilityStateRefs extends VulnerabilityStateRefs {
  loading: Ref<boolean>;
  error: Ref<string | null>;
}

function normalizeContainerIds(containerIds: VulnerabilityOverviewImage['containerIds']): string[] {
  if (!Array.isArray(containerIds)) {
    return [];
  }

  const uniqueContainerIds = new Set<string>();
  for (const containerId of containerIds) {
    if (typeof containerId === 'string' && containerId.length > 0) {
      uniqueContainerIds.add(containerId);
    }
  }
  return [...uniqueContainerIds];
}

function toNormalizedUpdateSummary(
  summary: VulnerabilityOverviewImage['updateSummary'],
): UpdateScanSummary | undefined {
  if (!summary) {
    return undefined;
  }
  return {
    unknown: normalizeSeverityCount(summary.unknown),
    low: normalizeSeverityCount(summary.low),
    medium: normalizeSeverityCount(summary.medium),
    high: normalizeSeverityCount(summary.high),
    critical: normalizeSeverityCount(summary.critical),
  };
}

function toVulnerability(
  vulnerability: VulnerabilityOverviewImage['vulnerabilities'][number],
  image: string,
): Vulnerability {
  return {
    id: vulnerability.id ?? 'unknown',
    severity: normalizeSeverity(vulnerability.severity),
    package: vulnerability.package ?? 'unknown',
    version: vulnerability.version ?? '',
    fixedIn: vulnerability.fixedIn ?? null,
    title: vulnerability.title ?? '',
    target: vulnerability.target ?? '',
    primaryUrl: vulnerability.primaryUrl ?? '',
    image,
    publishedDate: vulnerability.publishedDate ?? '',
  };
}

function parseOverviewVulnerabilities(
  overview: VulnerabilityOverview,
): ParsedOverviewVulnerabilities {
  const vulnerabilities: Vulnerability[] = [];
  const imageContainerMap: Record<string, string[]> = {};
  const updateSummaryMap: Record<string, UpdateScanSummary> = {};
  const latestScanAt = chooseLatestTimestamp(null, overview.latestScannedAt);

  const imageOverviews = Array.isArray(overview.images) ? overview.images : [];
  for (const imageOverview of imageOverviews) {
    const imageName = imageOverview.image || 'unknown';

    const imageContainerIds = normalizeContainerIds(imageOverview.containerIds);
    if (imageContainerIds.length > 0) {
      imageContainerMap[imageName] = imageContainerIds;
    }

    const updateSummary = toNormalizedUpdateSummary(imageOverview.updateSummary);
    if (updateSummary) {
      updateSummaryMap[imageName] = updateSummary;
    }

    const vulnList = Array.isArray(imageOverview.vulnerabilities)
      ? imageOverview.vulnerabilities
      : [];
    for (const vulnerability of vulnList) {
      vulnerabilities.push(toVulnerability(vulnerability, imageName));
    }
  }

  return {
    vulnerabilities,
    imageContainerMap,
    updateSummaryMap,
    latestScanAt,
  };
}

function buildVulnerabilitiesByImage(
  vulnerabilities: Vulnerability[],
): Record<string, Vulnerability[]> {
  const grouped: Record<string, Vulnerability[]> = {};
  const severityRank = (severity: Vulnerability['severity']) => severityOrder[severity] ?? 99;

  for (const vulnerability of vulnerabilities) {
    const bucket = grouped[vulnerability.image];
    if (bucket) bucket.push(vulnerability);
    else grouped[vulnerability.image] = [vulnerability];
  }

  for (const bucket of Object.values(grouped)) {
    bucket.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  }

  return grouped;
}

function createImageSummary(image: string): ImageSummary {
  return {
    image,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
    total: 0,
    fixable: 0,
  };
}

function incrementImageSummary(summary: ImageSummary, vulnerability: Vulnerability) {
  if (vulnerability.severity === 'CRITICAL') summary.critical += 1;
  else if (vulnerability.severity === 'HIGH') summary.high += 1;
  else if (vulnerability.severity === 'MEDIUM') summary.medium += 1;
  else if (vulnerability.severity === 'LOW') summary.low += 1;
  else summary.unknown += 1;

  if (vulnerability.fixedIn) summary.fixable += 1;
  summary.total += 1;
}

function annotateImageSummariesWithUpdates(
  summaries: ImageSummary[],
  containerIdsByImage: Record<string, string[]>,
  containers: Container[],
): void {
  if (containers.length === 0) {
    return;
  }
  const containerById = new Map<string, Container>();
  for (const container of containers) {
    containerById.set(container.id, container);
  }

  for (const summary of summaries) {
    const ids = containerIdsByImage[summary.image] ?? [];
    const withUpdate = ids.filter((id) => Boolean(containerById.get(id)?.newTag));
    if (withUpdate.length > 0) {
      summary.hasUpdate = true;
      summary.containersWithUpdate = withUpdate;
      for (const id of withUpdate) {
        const container = containerById.get(id);
        if (container?.releaseNotes) {
          summary.releaseNotes = container.releaseNotes;
          summary.releaseLink = container.releaseLink;
          break;
        }
        if (container?.releaseLink && !summary.releaseLink) {
          summary.releaseLink = container.releaseLink;
        }
      }
    }
  }
}

function buildImageSummaries(
  vulnerabilities: Vulnerability[],
  updateSummaries: Record<string, UpdateScanSummary>,
  containerIdsByImage: Record<string, string[]>,
  containers: Container[],
): ImageSummary[] {
  const map = new Map<string, ImageSummary>();

  for (const vulnerability of vulnerabilities) {
    let summary = map.get(vulnerability.image);
    if (!summary) {
      summary = createImageSummary(vulnerability.image);
      map.set(vulnerability.image, summary);
    }
    incrementImageSummary(summary, vulnerability);
  }

  for (const summary of map.values()) {
    const currentSummary: ContainerSecuritySummary = {
      critical: summary.critical,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
      unknown: summary.unknown,
    };
    summary.delta = computeSecurityDelta(currentSummary, updateSummaries[summary.image]);
  }

  const result = [...map.values()];
  annotateImageSummariesWithUpdates(result, containerIdsByImage, containers);
  return result;
}

function filterSummariesBySeverity(summaries: ImageSummary[], severity: string): ImageSummary[] {
  if (severity === 'all') {
    return summaries;
  }
  return summaries.filter((summary) => {
    if (severity === 'CRITICAL') return summary.critical > 0;
    if (severity === 'HIGH') return summary.high > 0;
    if (severity === 'MEDIUM') return summary.medium > 0;
    if (severity === 'LOW') return summary.low > 0;
    return summary.unknown > 0;
  });
}

function filterSummariesByFixability(summaries: ImageSummary[], fixFilter: string): ImageSummary[] {
  if (fixFilter === 'all') {
    return summaries;
  }
  return summaries.filter((summary) =>
    fixFilter === 'yes' ? summary.fixable > 0 : summary.fixable < summary.total,
  );
}

function sortSummaries(
  summaries: ImageSummary[],
  configuredField: string,
  securitySortAsc: boolean,
): ImageSummary[] {
  const field = normalizeSecuritySortField(configuredField);
  const asc = isSecuritySortField(configuredField) ? securitySortAsc : false;
  const sorted = [...summaries];
  sorted.sort((a, b) => {
    let cmp = 0;
    if (field === 'image') {
      cmp = a.image.localeCompare(b.image);
    } else {
      const av = readNumericSortValue(a, field);
      const bv = readNumericSortValue(b, field);
      cmp = av - bv;
    }
    return asc ? cmp : -cmp;
  });
  return sorted;
}

function buildFilteredSummaries(
  summaries: ImageSummary[],
  severityFilter: string,
  fixFilter: string,
  configuredSortField: string,
  securitySortAsc: boolean,
): ImageSummary[] {
  const severityFiltered = filterSummariesBySeverity(summaries, severityFilter);
  const fixFiltered = filterSummariesByFixability(severityFiltered, fixFilter);
  return sortSummaries(fixFiltered, configuredSortField, securitySortAsc);
}

function applyOverviewToState(overview: VulnerabilityOverview, state: VulnerabilityStateRefs) {
  state.totalContainerCount.value = normalizeSeverityCount(overview.totalContainers);
  state.scannedContainerCount.value = normalizeSeverityCount(overview.scannedContainers);
  const parsedOverview = parseOverviewVulnerabilities(overview);
  state.securityVulnerabilities.value = parsedOverview.vulnerabilities;
  state.containerIdsByImage.value = parsedOverview.imageContainerMap;
  state.updateScanSummaries.value = parsedOverview.updateSummaryMap;
  state.latestSecurityScanAt.value = parsedOverview.latestScanAt;
}

function clearVulnerabilityState(state: VulnerabilityStateRefs) {
  state.securityVulnerabilities.value = [];
  state.containerIdsByImage.value = {};
  state.updateScanSummaries.value = {};
  state.latestSecurityScanAt.value = null;
  state.totalContainerCount.value = 0;
  state.scannedContainerCount.value = 0;
}

function createFetchVulnerabilities(state: FetchVulnerabilityStateRefs) {
  return async function fetchVulnerabilities() {
    if (state.securityVulnerabilities.value.length === 0) {
      state.loading.value = true;
    }
    state.error.value = null;

    try {
      const overview = await getSecurityVulnerabilityOverview();
      applyOverviewToState(overview, state);
    } catch (caught: unknown) {
      state.error.value = errorMessage(caught, 'Failed to load vulnerability data');
      clearVulnerabilityState(state);
    } finally {
      state.loading.value = false;
    }
  };
}

export function useVulnerabilities({
  securitySortField,
  securitySortAsc,
  containers,
}: UseVulnerabilitiesOptions) {
  const loading = ref(true);
  const error = ref<string | null>(null);
  const securityVulnerabilities = ref<Vulnerability[]>([]);
  const containerIdsByImage = ref<Record<string, string[]>>({});
  const latestSecurityScanAt = ref<string | null>(null);
  const updateScanSummaries = ref<Record<string, UpdateScanSummary>>({});
  const totalContainerCount = ref(0);
  const scannedContainerCount = ref(0);

  const showSecFilters = ref(false);
  const secFilterSeverity = ref('all');
  const secFilterFix = ref('all');

  const activeSecFilterCount = computed(
    () => [secFilterSeverity, secFilterFix].filter((f) => f.value !== 'all').length,
  );

  function clearSecFilters() {
    secFilterSeverity.value = 'all';
    secFilterFix.value = 'all';
  }

  const vulnerabilitiesByImage = computed<Record<string, Vulnerability[]>>(() =>
    buildVulnerabilitiesByImage(securityVulnerabilities.value),
  );

  const imageSummaries = computed<ImageSummary[]>(() =>
    buildImageSummaries(
      securityVulnerabilities.value,
      updateScanSummaries.value,
      containerIdsByImage.value,
      containers?.value ?? [],
    ),
  );

  const filteredSummaries = computed(() =>
    buildFilteredSummaries(
      imageSummaries.value,
      secFilterSeverity.value,
      secFilterFix.value,
      securitySortField.value,
      securitySortAsc.value,
    ),
  );

  const vulnerabilityState = {
    securityVulnerabilities,
    containerIdsByImage,
    updateScanSummaries,
    latestSecurityScanAt,
    totalContainerCount,
    scannedContainerCount,
  };

  const fetchVulnerabilities = createFetchVulnerabilities({
    loading,
    error,
    ...vulnerabilityState,
  });

  return {
    loading,
    error,
    securityVulnerabilities,
    containerIdsByImage,
    latestSecurityScanAt,
    totalContainerCount,
    scannedContainerCount,
    showSecFilters,
    secFilterSeverity,
    secFilterFix,
    activeSecFilterCount,
    vulnerabilitiesByImage,
    imageSummaries,
    filteredSummaries,
    clearSecFilters,
    fetchVulnerabilities,
  };
}
