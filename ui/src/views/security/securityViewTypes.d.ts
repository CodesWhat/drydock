import type { UpdateEligibility } from '../../types/container';

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

export type SbomFormat = 'spdx-json' | 'cyclonedx-json';

export interface SbomState {
  componentCount?: number;
  document: unknown;
  documentJson: string;
  error: string | null;
  generatedAt?: string | null;
  loading: boolean;
  selectedFormat: SbomFormat;
  showDocument: boolean;
}

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

export interface ContainerChoice {
  id: string;
  name: string;
  host?: string;
  currentTag?: string;
  newTag?: string;
  updateKind?: 'major' | 'minor' | 'patch' | 'digest' | null;
  updateEligibility?: UpdateEligibility;
  blocked: boolean;
  blockerMessage?: string;
}
