import * as registry from '../../../registry/index.js';

interface DigestCachePollCycleAwareRegistry {
  startDigestCachePollCycle?: () => void;
  endDigestCachePollCycle?: () => void;
}

function getRegistries() {
  return registry.getState().registry;
}

export function startDigestCachePollCycleForRegistries() {
  const registries = Object.values(getRegistries()) as DigestCachePollCycleAwareRegistry[];
  for (const provider of registries) {
    provider.startDigestCachePollCycle?.();
  }
}

export function endDigestCachePollCycleForRegistries() {
  const registries = Object.values(getRegistries()) as DigestCachePollCycleAwareRegistry[];
  for (const provider of registries) {
    provider.endDigestCachePollCycle?.();
  }
}
