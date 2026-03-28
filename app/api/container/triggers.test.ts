import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../../test/helpers.js';
import { createTriggerHandlers } from './triggers.js';

function createTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'slack.notify',
    type: 'slack',
    name: 'notify',
    configuration: {},
    trigger: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createHarness(
  options: {
    container?: Record<string, unknown>;
    triggerMap?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const container = options.container ?? { id: 'c1' };
  const triggerMap = options.triggerMap ?? {};

  const storeContainer = {
    getContainer: vi.fn(() => container),
  };

  const deps = {
    storeContainer,
    mapComponentsToList: vi.fn((components: Record<string, unknown>) => Object.values(components)),
    getTriggers: vi.fn(() => triggerMap),
    Trigger: {
      parseIncludeOrIncludeTriggerString: vi.fn((value: string) => {
        const [idPart, thresholdPart] = value.split(':');
        return {
          id: idPart.trim(),
          threshold: thresholdPart?.trim() || 'all',
        };
      }),
      doesReferenceMatchId: vi.fn((triggerReference: string, triggerId: string) => {
        const reference = `${triggerReference}`.toLowerCase();
        const id = `${triggerId}`.toLowerCase();
        if (reference === id) {
          return true;
        }

        const idParts = id.split('.');
        const triggerName = idParts.at(-1);
        if (reference === triggerName) {
          return true;
        }

        if (idParts.length >= 2 && reference === idParts.slice(-2).join('.')) {
          return true;
        }

        return false;
      }),
    },
    sanitizeLogParam: vi.fn((value: unknown) => `${value}`),
    getErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : `${error}`,
    ),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
    },
  };

  return {
    container,
    triggerMap,
    storeContainer,
    deps,
    handlers: createTriggerHandlers(deps),
  };
}

async function callGetContainerTriggers(
  handlers: ReturnType<typeof createTriggerHandlers>,
  id: string | string[] | undefined = 'c1',
) {
  const res = createMockResponse();
  await handlers.getContainerTriggers({ params: { id } } as any, res as any);
  return res;
}

async function callRunTrigger(
  handlers: ReturnType<typeof createTriggerHandlers>,
  params: Record<string, string | string[]>,
) {
  const res = createMockResponse();
  await handlers.runTrigger({ params } as any, res as any);
  return res;
}

describe('api/container/triggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getContainerTriggers', () => {
    test('returns 404 when the container does not exist', async () => {
      const harness = createHarness();
      harness.storeContainer.getContainer.mockReturnValue(undefined);

      const res = await callGetContainerTriggers(harness.handlers);

      expect(harness.storeContainer.getContainer).toHaveBeenCalledWith('c1');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
      expect(harness.deps.mapComponentsToList).not.toHaveBeenCalled();
    });

    test('filters out agent-incompatible triggers for remote containers', async () => {
      const harness = createHarness({
        container: { id: 'c1', agent: 'agent-1' },
        triggerMap: {
          'slack.notify': createTrigger({ id: 'slack.notify' }),
          'docker.update': createTrigger({ id: 'docker.update', type: 'docker', name: 'update' }),
          'dockercompose.recreate': createTrigger({
            id: 'dockercompose.recreate',
            type: 'dockercompose',
            name: 'recreate',
          }),
          'agent-2.slack.notify': createTrigger({
            id: 'agent-2.slack.notify',
            agent: 'agent-2',
          }),
          'agent-1.slack.alert': createTrigger({
            id: 'agent-1.slack.alert',
            name: 'alert',
            agent: 'agent-1',
          }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];
      const associatedTriggers = payload.data;

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.total).toBe(2);
      expect(associatedTriggers.map((trigger) => trigger.id).sort()).toEqual([
        'agent-1.slack.alert',
        'slack.notify',
      ]);
    });

    test('uses type/name fallback when a listed trigger has no explicit id', async () => {
      const triggerWithoutId = createTrigger({
        id: undefined,
        name: 'orphan',
      });
      const harness = createHarness({
        container: { id: 'c1' },
        triggerMap: {},
      });
      harness.deps.mapComponentsToList.mockReturnValue([triggerWithoutId]);

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.total).toBe(1);
      expect(payload.data[0].name).toBe('orphan');
    });

    test('applies include thresholds and trims include entries before parsing', async () => {
      const harness = createHarness({
        container: { id: 'c1', triggerInclude: ' notify:patch , slack.alert : all ' },
        triggerMap: {
          'slack.notify': createTrigger({ id: 'slack.notify', name: 'notify' }),
          'slack.alert': createTrigger({ id: 'slack.alert', name: 'alert' }),
          'slack.other': createTrigger({ id: 'slack.other', name: 'other' }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];
      const associatedTriggers = payload.data;
      const thresholdsById = Object.fromEntries(
        associatedTriggers.map((trigger) => [trigger.id, trigger.configuration.threshold]),
      );

      expect(
        harness.deps.Trigger.parseIncludeOrIncludeTriggerString.mock.calls.map((call) => call[0]),
      ).toEqual(['notify:patch', 'slack.alert : all']);
      expect(payload.total).toBe(2);
      expect(associatedTriggers.map((trigger) => trigger.id).sort()).toEqual([
        'slack.alert',
        'slack.notify',
      ]);
      expect(thresholdsById).toEqual({
        'slack.notify': 'patch',
        'slack.alert': 'all',
      });
    });

    test('excludes triggers even when they match the include list', async () => {
      const harness = createHarness({
        container: {
          id: 'c1',
          triggerInclude: 'slack.notify:major',
          triggerExclude: 'notify',
        },
        triggerMap: {
          'slack.notify': createTrigger({ id: 'slack.notify', name: 'notify' }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: [], total: 0 });
    });

    test('drops triggers that are not present in the include list', async () => {
      const harness = createHarness({
        container: {
          id: 'c1',
          triggerInclude: 'slack.alert:major',
        },
        triggerMap: {
          'slack.notify': createTrigger({ id: 'slack.notify', name: 'notify' }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: [], total: 0 });
    });

    test('excludes triggers when only an exclude list is configured', async () => {
      const harness = createHarness({
        container: {
          id: 'c1',
          triggerExclude: 'notify',
        },
        triggerMap: {
          'slack.notify': createTrigger({ id: 'slack.notify', name: 'notify' }),
          'slack.alert': createTrigger({ id: 'slack.alert', name: 'alert' }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.total).toBe(1);
      expect(payload.data.map((trigger) => trigger.id)).toEqual(['slack.alert']);
    });

    test('filters dockercompose triggers by compose file affinity from container labels', async () => {
      const mysqlComposeTrigger = createTrigger({
        id: 'dockercompose.mysql',
        type: 'dockercompose',
        name: 'mysql',
        configuration: { file: '/opt/drydock/test/mysql/compose.yaml' },
        getDefaultComposeFilePath: () => '/opt/drydock/test/mysql/compose.yaml',
        getComposeFilesForContainer: () => [
          '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
        ],
      });
      const monitoringComposeTrigger = createTrigger({
        id: 'dockercompose.monitoring',
        type: 'dockercompose',
        name: 'monitoring',
        configuration: { file: '/opt/drydock/test/monitoring/compose.yaml' },
        getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring/compose.yaml',
        getComposeFilesForContainer: () => [
          '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
        ],
      });

      const harness = createHarness({
        container: {
          id: 'c1',
          labels: {
            'com.docker.compose.project.config_files':
              '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
          },
        },
        triggerMap: {
          'dockercompose.mysql': mysqlComposeTrigger,
          'dockercompose.monitoring': monitoringComposeTrigger,
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];
      const associatedTriggers = payload.data;

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.total).toBe(1);
      expect(associatedTriggers.map((trigger) => trigger.id)).toEqual(['dockercompose.monitoring']);
    });
  });

  describe('runTrigger', () => {
    test('returns 404 when the container does not exist', async () => {
      const harness = createHarness();
      harness.storeContainer.getContainer.mockReturnValue(undefined);

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerType: 'slack',
        triggerName: 'notify',
      });

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
      expect(harness.deps.getTriggers).not.toHaveBeenCalled();
    });

    test('blocks local docker trigger execution for remote containers', async () => {
      const harness = createHarness({
        container: { id: 'c1', agent: 'agent-1' },
      });

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerType: 'docker',
        triggerName: 'update',
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Cannot execute local docker trigger on remote container agent-1.c1',
      });
      expect(harness.deps.getTriggers).not.toHaveBeenCalled();
    });

    test('allows non-docker triggers for remote containers without an explicit trigger agent', async () => {
      const trigger = createTrigger({
        id: 'slack.notify',
        name: 'notify',
        trigger: vi.fn().mockResolvedValue(undefined),
      });
      const harness = createHarness({
        container: { id: 'c1', agent: 'agent-1' },
        triggerMap: {
          'slack.notify': trigger,
        },
      });

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerType: 'slack',
        triggerName: 'notify',
      });

      expect(trigger.trigger).toHaveBeenCalledWith(harness.container);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({});
    });

    test('returns 404 when the trigger cannot be found', async () => {
      const harness = createHarness({
        container: { id: 'c1' },
      });

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerType: 'slack',
        triggerName: 'missing',
      });

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Trigger not found' });
    });

    test('returns 409 when trigger targets a temporary rollback container', async () => {
      const trigger = createTrigger({
        id: 'slack.notify',
        name: 'notify',
      });
      const harness = createHarness({
        container: { id: 'c1', name: 'app-old-1234567890' },
        triggerMap: {
          'slack.notify': trigger,
        },
      });

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerType: 'slack',
        triggerName: 'notify',
      });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Cannot update temporary rollback container',
      });
      expect(trigger.trigger).not.toHaveBeenCalled();
    });

    test('resolves and executes an agent-qualified trigger id', async () => {
      const trigger = createTrigger({
        id: 'agent-1.slack.notify',
        name: 'notify',
        trigger: vi.fn().mockResolvedValue(undefined),
      });
      const harness = createHarness({
        container: { id: 'c1', agent: 'agent-1' },
        triggerMap: {
          'agent-1.slack.notify': trigger,
        },
      });

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerAgent: 'agent-1',
        triggerType: 'slack',
        triggerName: 'notify',
      });

      expect(trigger.trigger).toHaveBeenCalledWith(harness.container);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({});
    });

    test('returns 500 when trigger execution throws', async () => {
      const trigger = createTrigger({
        id: 'slack.notify',
        name: 'notify',
        trigger: vi.fn().mockRejectedValue(new Error('trigger exploded')),
      });
      const harness = createHarness({
        container: { id: 'c1' },
        triggerMap: {
          'slack.notify': trigger,
        },
      });

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerType: 'slack',
        triggerName: 'notify',
      });

      expect(trigger.trigger).toHaveBeenCalledWith(harness.container);
      expect(harness.deps.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('trigger exploded'),
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'trigger exploded',
      });
    });
  });
});
