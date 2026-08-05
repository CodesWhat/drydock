import type { Container } from '../../model/container.js';
import {
  maturityMinAgeDaysToMilliseconds,
  resolveMaturityMinAgeDays,
} from '../../model/maturity-policy.js';
import { getFirstNonEmptyQueryValue } from './query-values.js';
import { getContainerUpdateAge } from './update-age.js';

const DEFAULT_UI_MATURITY_THRESHOLD_DAYS = 7;
const ESTABLISHED_UPDATE_AGE_DAYS = 30;

export type ContainerMaturityFilter = 'hot' | 'mature' | 'established';

export function parseContainerMaturityFilter(
  maturityQuery: unknown,
): ContainerMaturityFilter | undefined {
  const normalized = getFirstNonEmptyQueryValue(maturityQuery)?.toLowerCase();
  if (normalized === 'hot' || normalized === 'mature' || normalized === 'established') {
    return normalized;
  }
  return undefined;
}

function resolveUiMaturityThresholdDays(): number {
  return resolveMaturityMinAgeDays(
    process.env.DD_UI_MATURITY_THRESHOLD_DAYS,
    DEFAULT_UI_MATURITY_THRESHOLD_DAYS,
  );
}

function getContainerMaturityLevel(
  container: Container,
  uiMaturityThresholdDays: number,
): ContainerMaturityFilter | undefined {
  const cachedLevel = container.updateMaturityLevel;
  if (cachedLevel === 'hot' || cachedLevel === 'mature' || cachedLevel === 'established') {
    return cachedLevel;
  }

  const updateAge = getContainerUpdateAge(container);
  if (updateAge === undefined) {
    return undefined;
  }
  if (updateAge >= maturityMinAgeDaysToMilliseconds(ESTABLISHED_UPDATE_AGE_DAYS)) {
    return 'established';
  }
  const maturityThresholdDays = resolveMaturityMinAgeDays(
    container.updatePolicy?.maturityMinAgeDays,
    uiMaturityThresholdDays,
  );
  return updateAge >= maturityMinAgeDaysToMilliseconds(maturityThresholdDays) ? 'mature' : 'hot';
}

export function applyContainerMaturityFilter(
  containers: Container[],
  maturityFilter: ContainerMaturityFilter | undefined,
): Container[] {
  if (!maturityFilter) {
    return containers;
  }

  const uiMaturityThresholdDays = resolveUiMaturityThresholdDays();
  return containers.filter(
    (container) => getContainerMaturityLevel(container, uiMaturityThresholdDays) === maturityFilter,
  );
}
