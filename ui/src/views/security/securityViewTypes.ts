export interface Vulnerability {
  id: string;
  severity: string;
  package: string;
  version: string;
  fixedIn: string | null;
  title?: string;
  target?: string;
  primaryUrl?: string;
  image: string;
  publishedDate: string;
}

export interface SeveritySummaryCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface SecurityDelta {
  fixed: number;
  new: number;
  fixedCritical: number;
  fixedHigh: number;
  newCritical: number;
  newHigh: number;
}

interface ImageSummary extends SeveritySummaryCounts {
  image: string;
  total: number;
  fixable: number;
  delta?: SecurityDelta;
}

export type SbomFormat = 'spdx-json' | 'cyclonedx-json';

export interface SecurityRuntimeToolStatus {
  enabled: boolean;
  command: string;
  commandAvailable: boolean | null;
  status: 'ready' | 'missing' | 'disabled';
  message: string;
}

export interface SecurityRuntimeStatus {
  checkedAt: string;
  ready: boolean;
  scanner: SecurityRuntimeToolStatus & {
    scanner: string;
    server: string;
  };
  signature: SecurityRuntimeToolStatus;
  sbom: {
    enabled: boolean;
    formats: string[];
  };
  requirements: string[];
}

interface UpdateScanSummary extends SeveritySummaryCounts {
  unknown: number;
}

export interface SecurityEmptyState {
  title: string;
  description: string | null;
  showSetupGuide: boolean;
  showScanButton: boolean;
}

export interface SecurityViewEmptyStateInput {
  hasVulnerabilityData: boolean;
  scannerSetupNeeded: boolean;
  scannerMessage: string | null | undefined;
}
