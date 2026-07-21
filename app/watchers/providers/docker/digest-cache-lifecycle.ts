import * as registry from '../../../registry/index.js';

interface DigestCachePollCycleAwareRegistry {
  startDigestCachePollCycle?: () => unknown;
  endDigestCachePollCycle?: (handle?: unknown) => void;
}

export type DigestCachePollCycle = Map<DigestCachePollCycleAwareRegistry, unknown>;

function getRegistries() {
  return registry.getState().registry;
}

export function startDigestCachePollCycleForRegistries() {
  const registries = Object.values(getRegistries()) as DigestCachePollCycleAwareRegistry[];
  const cycle: DigestCachePollCycle = new Map();
  for (const provider of registries) {
    if (provider.startDigestCachePollCycle) {
      cycle.set(provider, provider.startDigestCachePollCycle());
    }
  }
  return cycle;
}

export function endDigestCachePollCycleForRegistries(cycle?: DigestCachePollCycle) {
  const entries = cycle
    ? cycle.entries()
    : (Object.values(getRegistries()) as DigestCachePollCycleAwareRegistry[]).map(
        (provider) => [provider, undefined] as const,
      );
  for (const [provider, handle] of entries) {
    provider.endDigestCachePollCycle?.(handle);
  }
}
