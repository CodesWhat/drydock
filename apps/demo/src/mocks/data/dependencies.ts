/**
 * Dependency edges between the seed containers, by name. `from` depends on
 * `to`, so `to` updates first. Names match `data/containers.ts`.
 */
export interface DemoDependencyEdge {
  from: string;
  to: string;
  action: 'update' | 'restart';
  source: 'label' | 'compose' | 'override';
}

export const dependencyEdges: DemoDependencyEdge[] = [
  { from: 'grafana', to: 'prometheus', action: 'update', source: 'label' },
  { from: 'grafana', to: 'loki', action: 'update', source: 'label' },
  { from: 'sonarr', to: 'prowlarr', action: 'update', source: 'compose' },
  { from: 'radarr', to: 'prowlarr', action: 'update', source: 'compose' },
  { from: 'authelia', to: 'traefik', action: 'restart', source: 'label' },
];
