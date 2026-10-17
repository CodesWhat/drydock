import { ref } from 'vue';
import { getAllContainers } from '../services/container';
import type { LabelOverrideSnapshot } from '../services/label-override';
import { isNotificationProvider } from '../services/notification-editor';
import { getAllTriggers } from '../services/trigger';
import type { KnownTriggers } from './labelOverrideLists';

interface CandidateContainer {
  name: string;
  agent: string;
  watcher: string;
}

type CandidateScope = Pick<LabelOverrideSnapshot['scope'], 'agent' | 'watcher' | 'appliesTo'>;

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : 1));
}

/**
 * What the pickers offer: the registered triggers split by kind, and the containers a
 * dependency can point at. A list that fails to load stays unknown, so the editors fall back
 * to free entry and the server's own answer instead of blocking.
 */
function useLabelOverrideCandidates() {
  const triggers = ref<KnownTriggers | null>(null);
  const containers = ref<CandidateContainer[] | null>(null);
  let generation = 0;

  async function load() {
    const current = ++generation;
    const [triggerResult, containerResult] = await Promise.allSettled([
      getAllTriggers(),
      getAllContainers(),
    ]);
    if (current !== generation) return;
    triggers.value =
      triggerResult.status === 'fulfilled'
        ? {
            action: sortedUnique(
              triggerResult.value.filter((t) => !isNotificationProvider(t.type)).map((t) => t.id),
            ),
            notification: sortedUnique(
              triggerResult.value.filter((t) => isNotificationProvider(t.type)).map((t) => t.id),
            ),
          }
        : null;
    containers.value =
      containerResult.status === 'fulfilled'
        ? containerResult.value.flatMap((container) =>
            typeof container.name === 'string'
              ? [
                  {
                    name: container.name,
                    agent: typeof container.agent === 'string' ? container.agent : '',
                    watcher: typeof container.watcher === 'string' ? container.watcher : '',
                  },
                ]
              : [],
          )
        : null;
  }

  /** Container names on the scope's watcher and agent, without the scope's own containers. */
  function containerNames(scope: CandidateScope): string[] {
    const own = new Set(scope.appliesTo.map((member) => member.name));
    return sortedUnique(
      (containers.value ?? [])
        .filter(
          (container) =>
            container.watcher === scope.watcher &&
            container.agent === (scope.agent ?? '') &&
            !own.has(container.name),
        )
        .map((container) => container.name),
    );
  }

  return { triggers, load, containerNames };
}

export { useLabelOverrideCandidates };
