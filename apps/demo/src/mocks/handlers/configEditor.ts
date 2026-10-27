import { HttpResponse, http } from 'msw';
import { triggers } from '../data/triggers';
import { watchers } from '../data/watchers';
import { readJsonRecord } from './json';

type Scalar = string | number | boolean;

interface FieldState {
  path: string[];
  present: boolean;
  value?: Scalar;
  effectiveValue?: Scalar;
  source: string;
}

interface EditorRow {
  id: string;
  type?: string;
  name: string;
  agent?: string;
  category?: 'notification' | 'action';
  fields: Record<string, FieldState>;
}

const actionTypes = new Set(['docker', 'dockercompose', 'portainer', 'command']);

function envKey(path: string[]): string {
  return `DD_${path
    .join('_')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')}`;
}

function buildFields(
  scope: string,
  rowId: string,
  defaults: Record<string, Scalar | undefined>,
  configured: Record<string, Scalar | undefined> = {},
): Record<string, FieldState> {
  return Object.fromEntries(
    Object.entries(defaults).map(([field, fallback]) => {
      const value = configured[field];
      const state: FieldState = {
        path: [scope, rowId, field],
        present: value !== undefined,
        source: value !== undefined ? 'env' : 'default',
        ...(value !== undefined ? { value } : {}),
        ...((value ?? fallback) !== undefined
          ? { effectiveValue: (value ?? fallback) as Scalar }
          : {}),
      };
      return [field, state];
    }),
  );
}

function createEditor(
  segment: string,
  collectionKey: string,
  defaultsByField: Record<string, Scalar | undefined>,
  buildRows: () => EditorRow[],
) {
  const rows = buildRows();
  let revisionCounter = 1;
  const revision = () => `demo-rev-${revisionCounter}`;
  const outcome = (overrides: Record<string, unknown>) => ({
    saved: false,
    applied: false,
    changedKeys: [],
    restartRequired: [],
    errors: [],
    ...overrides,
  });

  return [
    http.get(`/api/v1/config/editor/${segment}`, () =>
      HttpResponse.json({
        available: true,
        revision: revision(),
        [collectionKey]: structuredClone(rows),
      }),
    ),

    http.patch(`/api/v1/config/editor/${segment}`, async ({ request }) => {
      const body = await readJsonRecord(request);
      if (!body || typeof body.revision !== 'string' || !Array.isArray(body.changes)) {
        return HttpResponse.json(outcome({ error: 'Invalid editor request' }), { status: 400 });
      }
      if (body.revision !== revision()) {
        return HttpResponse.json(
          outcome({
            error: 'Configuration changed since it was read',
            details: { reason: 'stale-revision' },
          }),
          { status: 409 },
        );
      }
      const changedKeys: string[] = [];
      for (const change of body.changes as Array<Record<string, unknown>>) {
        const path = Array.isArray(change.path) ? (change.path as string[]) : [];
        const [, rowId, field] = path;
        const state = rows.find((row) => row.id === rowId)?.fields[field];
        if (!state || (change.operation !== 'set' && change.operation !== 'remove')) {
          return HttpResponse.json(outcome({ error: 'Unknown editor field' }), { status: 400 });
        }
        if (change.operation === 'set') {
          state.present = true;
          state.value = change.value as Scalar;
          state.effectiveValue = change.value as Scalar;
          state.source = 'env';
        } else {
          state.present = false;
          delete state.value;
          state.effectiveValue = defaultsByField[field];
          state.source = 'default';
        }
        changedKeys.push(envKey(path));
      }
      if (changedKeys.length > 0) revisionCounter += 1;
      return HttpResponse.json(
        outcome({
          saved: true,
          applied: true,
          revision: revision(),
          changedKeys,
          reload: { applied: true, errors: [] },
        }),
      );
    }),
  ];
}

const watcherDefaults: Record<string, Scalar | undefined> = {
  cron: '0 * * * *',
  maintenancewindow: undefined,
  maintenancewindowtz: 'UTC',
  maintenancewindowscope: 'all',
};
const notificationDefaults: Record<string, Scalar | undefined> = {
  threshold: 'all',
  once: true,
  mode: 'simple',
  securitymode: 'simple',
  digestcron: undefined,
  resolvenotifications: false,
};
const actionDefaults: Record<string, Scalar | undefined> = {
  auto: 'all',
  order: 10,
  concurrency: 1,
};

export const configEditorHandlers = [
  ...createEditor('watchers', 'watchers', watcherDefaults, () =>
    watchers.map((watcher) => ({
      id: watcher.id,
      name: watcher.name,
      ...('agent' in watcher ? { agent: watcher.agent as string } : {}),
      fields: buildFields('watcher', watcher.id, watcherDefaults, {
        cron: watcher.configuration.pollInterval,
      }),
    })),
  ),
  ...createEditor('triggers', 'triggers', notificationDefaults, () =>
    triggers
      .filter((trigger) => !actionTypes.has(trigger.type))
      .map((trigger) => ({
        id: trigger.id,
        type: trigger.type,
        name: trigger.name,
        category: 'notification' as const,
        fields: buildFields('trigger', trigger.id, notificationDefaults, { threshold: 'all' }),
      })),
  ),
  ...createEditor('actions', 'actions', actionDefaults, () =>
    triggers
      .filter((trigger) => actionTypes.has(trigger.type))
      .map((trigger) => ({
        id: trigger.id,
        type: trigger.type,
        name: trigger.name,
        category: 'action' as const,
        fields: buildFields('action', trigger.id, actionDefaults, { auto: 'all' }),
      })),
  ),
];
