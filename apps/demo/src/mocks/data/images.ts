import type { ImageHostSummary, ImageInventoryItem } from '@/services/images';
import { daysToMs } from '../../utils/time';
import { containers } from './containers';

const MIB = 1024 ** 2;

function hex(seed: string): string {
  let h = 0x811c9dc5;
  let out = '';
  for (let round = 0; round < 8; round += 1) {
    for (const ch of `${seed}:${round}`) {
      h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

function sizeFor(seed: string): number {
  return (60 + (Number.parseInt(hex(seed).slice(0, 4), 16) % 420)) * MIB;
}

function image(
  ref: string,
  opts: { containers: number; ageDays: number; tags?: string[]; seenDaysAgo?: number },
): ImageInventoryItem {
  const repo = ref.split(':')[0];
  const size = sizeFor(ref);
  return {
    id: `sha256:${hex(ref)}`,
    repoTags: opts.tags ?? [ref],
    repoDigests: [`${repo}@sha256:${hex(`${ref}:digest`)}`],
    size,
    reclaimable: opts.containers === 0 ? size : 0,
    created: new Date(Date.now() - daysToMs(opts.ageDays)).toISOString(),
    containers: opts.containers,
    dangling: (opts.tags ?? [ref]).length === 0,
    watcher: 'local',
    ...(opts.seenDaysAgo !== undefined
      ? { lastSeen: new Date(Date.now() - daysToMs(opts.seenDaysAgo)).toISOString() }
      : {}),
  };
}

/** One image per running demo container, plus leftovers from earlier updates. */
export function createImageInventory(): ImageInventoryItem[] {
  const current = containers.map((container, index) =>
    image(`${container.image.name}:${container.image.tag.value}`, {
      containers: 1,
      ageDays: 20 + index * 9,
    }),
  );
  const leftovers = [
    image('grafana/grafana:11.2.1', { containers: 0, ageDays: 64, seenDaysAgo: 18 }),
    image('prom/prometheus:v2.53.2', { containers: 0, ageDays: 88, seenDaysAgo: 30 }),
    image('grafana/grafana:11.1.0', { containers: 0, ageDays: 120, tags: [], seenDaysAgo: 45 }),
    image('linuxserver/sonarr:4.0.9', { containers: 0, ageDays: 70, tags: [], seenDaysAgo: 12 }),
  ];
  return [...current, ...leftovers].sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));
}

export const imageHosts: ImageHostSummary[] = [
  { id: 'docker.local', name: 'local', supported: true },
  {
    id: 'nas-agent.docker.nas',
    name: 'nas',
    agent: 'nas-agent',
    supported: false,
    reason: 'agent-transport-unsupported',
  },
];
