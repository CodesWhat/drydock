import type { WatcherEditOutcome, WatcherEditRow } from '@/services/config-editor';

export function actionSnapshot(type = 'docker', agent?: string) {
  const field = (
    name: string,
    value: string | number | boolean,
  ): WatcherEditRow['fields']['cron'] => ({
    path: ['Action', type, 'Policy', name],
    present: true,
    source: 'file',
    value,
    effectiveValue: value,
  });
  return {
    available: true,
    revision: 'initial',
    actions: [
      {
        id: `${type}.policy`,
        type,
        name: 'policy',
        agent,
        category: 'action' as const,
        fields: {
          auto: field('auto', true),
          order: field('order', -2.5),
          concurrency: field('concurrency', 3),
        },
      },
    ],
  };
}
export function actionOutcome(overrides: Partial<WatcherEditOutcome> = {}): WatcherEditOutcome {
  return {
    status: 200,
    saved: true,
    applied: true,
    revision: 'next',
    changedKeys: [],
    restartRequired: [],
    errors: [],
    ...overrides,
  };
}
