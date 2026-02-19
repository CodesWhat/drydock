/** Shared UI container type used across views, composables, and templates. */

export interface ContainerDetails {
  ports: string[];
  volumes: string[];
  env: { key: string; value: string }[];
  labels: string[];
}

export interface Container {
  id: string;
  name: string;
  image: string;
  currentTag: string;
  newTag: string | null;
  status: 'running' | 'stopped';
  registry: 'dockerhub' | 'ghcr' | 'custom';
  updateKind: 'major' | 'minor' | 'patch' | 'digest' | null;
  bouncer: 'safe' | 'unsafe' | 'blocked';
  server: string;
  details: ContainerDetails;
}
