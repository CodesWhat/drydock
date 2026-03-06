import { computed, type Ref, ref } from 'vue';
import { getAllContainers } from '../services/container';
import type { ContainerSecurityDelta, ContainerSecuritySummary } from '../types/container';
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
}

interface UpdateScanSummary extends ContainerSecuritySummary {}

export function useVulnerabilities({
  securitySortField,
  securitySortAsc,
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

  const vulnerabilitiesByImage = computed<Record<string, Vulnerability[]>>(() => {
    const grouped: Record<string, Vulnerability[]> = {};

    for (const vulnerability of securityVulnerabilities.value) {
      const existing = grouped[vulnerability.image];
      if (existing) {
        existing.push(vulnerability);
      } else {
        grouped[vulnerability.image] = [vulnerability];
      }
    }

    for (const vulnerabilities of Object.values(grouped)) {
      vulnerabilities.sort(
        (a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99),
      );
    }

    return grouped;
  });

  const imageSummaries = computed<ImageSummary[]>(() => {
    const map = new Map<string, ImageSummary>();

    for (const vuln of securityVulnerabilities.value) {
      let summary = map.get(vuln.image);
      if (!summary) {
        summary = {
          image: vuln.image,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          unknown: 0,
          total: 0,
          fixable: 0,
        };
        map.set(vuln.image, summary);
      }

      if (vuln.severity === 'CRITICAL') summary.critical += 1;
      else if (vuln.severity === 'HIGH') summary.high += 1;
      else if (vuln.severity === 'MEDIUM') summary.medium += 1;
      else if (vuln.severity === 'LOW') summary.low += 1;
      else summary.unknown += 1;

      if (vuln.fixedIn) summary.fixable += 1;
      summary.total += 1;
    }

    for (const summary of map.values()) {
      const currentSummary: ContainerSecuritySummary = {
        critical: summary.critical,
        high: summary.high,
        medium: summary.medium,
        low: summary.low,
        unknown: summary.unknown,
      };
      const updateSummary = updateScanSummaries.value[summary.image];
      summary.delta = computeSecurityDelta(currentSummary, updateSummary);
    }

    return [...map.values()];
  });

  const filteredSummaries = computed(() => {
    let list = [...imageSummaries.value];

    if (secFilterSeverity.value !== 'all') {
      const severity = secFilterSeverity.value;
      list = list.filter((summary) => {
        if (severity === 'CRITICAL') return summary.critical > 0;
        if (severity === 'HIGH') return summary.high > 0;
        if (severity === 'MEDIUM') return summary.medium > 0;
        if (severity === 'LOW') return summary.low > 0;
        return summary.unknown > 0;
      });
    }

    if (secFilterFix.value !== 'all') {
      list = list.filter((summary) =>
        secFilterFix.value === 'yes' ? summary.fixable > 0 : summary.fixable < summary.total,
      );
    }

    const configuredField = securitySortField.value;
    const field = normalizeSecuritySortField(configuredField);
    const asc = isSecuritySortField(configuredField) ? securitySortAsc.value : false;
    list.sort((a, b) => {
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

    return list;
  });

  async function fetchVulnerabilities() {
    if (securityVulnerabilities.value.length === 0) {
      loading.value = true;
    }
    error.value = null;

    try {
      const containers = await getAllContainers({ includeVulnerabilities: true });
      totalContainerCount.value = containers.length;
      const vulnerabilities: Vulnerability[] = [];
      const imageContainerMap: Record<string, string[]> = {};
      const updateSummaryMap: Record<string, UpdateScanSummary> = {};
      let latestScanAt: string | null = null;
      let scannedCount = 0;

      for (const container of containers) {
        const scan = container.security?.scan;
        if (!scan) continue;
        scannedCount += 1;

        const imageName = container.displayName || container.name || 'unknown';
        latestScanAt = chooseLatestTimestamp(latestScanAt, scan.scannedAt);

        if (typeof container.id === 'string' && container.id.length > 0) {
          const containerIds = imageContainerMap[imageName] || [];
          if (!containerIds.includes(container.id)) {
            containerIds.push(container.id);
            imageContainerMap[imageName] = containerIds;
          }
        }

        const updateScan = container.security?.updateScan;
        if (updateScan?.summary) {
          updateSummaryMap[imageName] = {
            unknown: normalizeSeverityCount(updateScan.summary.unknown),
            low: normalizeSeverityCount(updateScan.summary.low),
            medium: normalizeSeverityCount(updateScan.summary.medium),
            high: normalizeSeverityCount(updateScan.summary.high),
            critical: normalizeSeverityCount(updateScan.summary.critical),
          };
        }

        const vulnList = Array.isArray(scan.vulnerabilities) ? scan.vulnerabilities : [];
        for (const vulnerability of vulnList) {
          vulnerabilities.push({
            id: vulnerability.id ?? 'unknown',
            severity: normalizeSeverity(vulnerability.severity),
            package: vulnerability.packageName ?? vulnerability.package ?? 'unknown',
            version: vulnerability.installedVersion ?? vulnerability.version ?? '',
            fixedIn: vulnerability.fixedVersion ?? vulnerability.fixedIn ?? null,
            title: vulnerability.title ?? vulnerability.Title ?? '',
            target: vulnerability.target ?? vulnerability.Target ?? '',
            primaryUrl: vulnerability.primaryUrl ?? vulnerability.PrimaryURL ?? '',
            image: imageName,
            publishedDate: vulnerability.publishedDate ?? '',
          });
        }
      }

      scannedContainerCount.value = scannedCount;

      securityVulnerabilities.value = vulnerabilities;
      containerIdsByImage.value = imageContainerMap;
      updateScanSummaries.value = updateSummaryMap;
      latestSecurityScanAt.value = latestScanAt;
    } catch (caught: unknown) {
      error.value = errorMessage(caught, 'Failed to load vulnerability data');
      containerIdsByImage.value = {};
      updateScanSummaries.value = {};
      latestSecurityScanAt.value = null;
      totalContainerCount.value = 0;
      scannedContainerCount.value = 0;
    } finally {
      loading.value = false;
    }
  }

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
