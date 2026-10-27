import type { ApiContainerUpdateOperation } from '@/types/api';
import { daysToMs } from '../../utils/time';
import { containers } from './containers';

/**
 * Past update runs per container, oldest first. Each succeeded run leaves a
 * backup of the image it replaced (what the rollback panel lists); a
 * rolled-back run leaves none because the old container was restored.
 */
interface HistorySpec {
  from: string;
  to: string;
  daysAgo: number;
  outcome?: 'succeeded' | 'rolled-back';
}

const historyByContainer: Record<string, HistorySpec[]> = {
  grafana: [
    { from: '11.1.4', to: '11.2.0', daysAgo: 41 },
    { from: '11.2.0', to: '11.3.0', daysAgo: 19 },
  ],
  loki: [
    { from: '3.0.1', to: '3.1.1', daysAgo: 52 },
    { from: '3.1.1', to: '3.2.0', daysAgo: 24 },
  ],
  jellyfin: [
    { from: '10.9.11', to: '10.10.0', daysAgo: 38 },
    { from: '10.10.0', to: '10.10.2', daysAgo: 21, outcome: 'rolled-back' },
    { from: '10.10.0', to: '10.10.3', daysAgo: 14 },
  ],
  prowlarr: [{ from: '1.24.3', to: '1.25.0', daysAgo: 17 }],
  authelia: [{ from: '4.38.10', to: '4.38.16', daysAgo: 29 }],
  prometheus: [{ from: 'v2.53.1', to: 'v2.54.0', daysAgo: 33 }],
  traefik: [{ from: 'v3.1.6', to: 'v3.2.0', daysAgo: 26 }],
  sonarr: [{ from: '4.0.9', to: '4.0.10', daysAgo: 12 }],
  radarr: [{ from: '5.12.2', to: '5.14.0', daysAgo: 20 }],
};

function at(daysAgo: number): string {
  return new Date(Date.now() - daysToMs(daysAgo)).toISOString();
}

function runsFor(name: string) {
  const container = containers.find((candidate) => candidate.name === name);
  return container ? { container, runs: historyByContainer[name] ?? [] } : undefined;
}

export function backupsFor(containerId: string) {
  const match = containers.find((candidate) => candidate.id === containerId);
  const found = match ? runsFor(match.name) : undefined;
  if (!found) return [];
  return found.runs
    .filter((run) => (run.outcome ?? 'succeeded') === 'succeeded')
    .map((run) => ({
      id: `bkp-${found.container.name}-${run.from}`,
      containerId: found.container.id,
      containerName: found.container.name,
      imageName: found.container.image.name,
      imageTag: run.from,
      timestamp: at(run.daysAgo),
      triggerName: 'docker.local',
    }))
    .reverse();
}

export function updateOperationsFor(containerId: string): ApiContainerUpdateOperation[] {
  const match = containers.find((candidate) => candidate.id === containerId);
  const found = match ? runsFor(match.name) : undefined;
  if (!found) return [];
  return found.runs
    .map((run, index): ApiContainerUpdateOperation => {
      const createdAt = at(run.daysAgo);
      const completedAt = new Date(Date.parse(createdAt) + 48_000).toISOString();
      const base = {
        id: `op-${found.container.name}-${index + 1}`,
        kind: 'container-update' as const,
        containerId: found.container.id,
        containerName: found.container.name,
        triggerName: 'docker.local',
        fromVersion: run.from,
        toVersion: run.to,
        targetImage: `${found.container.image.name}:${run.to}`,
        createdAt,
        updatedAt: completedAt,
        completedAt,
      };
      if (run.outcome === 'rolled-back') {
        return {
          ...base,
          status: 'rolled-back',
          phase: 'rolled-back',
          rollbackReason: 'health-gate-failed',
          lastError: 'Health gate failed: container did not report healthy within 60s',
        };
      }
      return { ...base, status: 'succeeded', phase: 'succeeded' };
    })
    .reverse();
}
