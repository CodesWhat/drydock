/** Shared UI container type used across views, composables, and templates. */

export interface ContainerDetails {
  ports: string[];
  volumes: string[];
  env: { key: string; value: string }[];
  labels: string[];
}

export interface ContainerSecuritySummary {
  unknown: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  icon: string;
  currentTag: string;
  newTag: string | null;
  tagFamily?: string;
  imageVariant?: string;
  imageDigestWatch?: boolean;
  imageTagSemver?: boolean;
  releaseLink?: string;
  status: 'running' | 'stopped';
  registry: 'dockerhub' | 'ghcr' | 'custom';
  registryName?: string;
  registryUrl?: string;
  updateKind: 'major' | 'minor' | 'patch' | 'digest' | null;
  updateDetectedAt?: string;
  updatePolicyState?: 'snoozed' | 'skipped';
  suppressedUpdateTag?: string;
  registryError?: string;
  noUpdateReason?: string;
  bouncer: 'safe' | 'unsafe' | 'blocked';
  securityScanState?: 'scanned' | 'not-scanned';
  securitySummary?: ContainerSecuritySummary;
  server: string;
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  details: ContainerDetails;
}
