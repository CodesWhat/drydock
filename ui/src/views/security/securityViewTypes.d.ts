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
  backend: 'command' | 'docker' | 'remote';
  availabilityPolicy: 'block' | 'warn';
  gate: {
    mode: 'on' | 'off';
    allowNoWorse: boolean;
  };
  scanner: SecurityRuntimeToolStatus & {
    scanner: string;
    server: string;
  };
  signature: SecurityRuntimeToolStatus;
  sbom: {
    enabled: boolean;
    formats: string[];
    generator: 'trivy' | 'syft';
  };
  providers: Array<
    SecurityRuntimeToolStatus & {
      provider: 'trivy' | 'grype' | 'syft';
      role: 'scanner' | 'sbom';
    }
  >;
  assets: Array<{
    provider: 'trivy' | 'grype' | 'syft';
    backend: string;
    configuredImage: string;
    resolvedDigest?: string;
    version?: string;
    state: 'missing' | 'pulling' | 'warming' | 'ready' | 'error';
    lastError?: string;
    databaseUpdatedAt?: string;
    cacheUpdatedAt?: string;
  }>;
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
