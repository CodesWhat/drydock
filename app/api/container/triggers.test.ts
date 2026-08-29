import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../../test/helpers.js';
import * as requestUpdate from '../../updates/request-update.js';
import { createTriggerHandlers } from './triggers.js';

function createTrigger(overrides: Record<string, unknown> = {}) {
  const trigger = {
    id: 'slack.notify',
    type: 'slack',
    name: 'notify',
    configuration: {},
    trigger: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { getId: () => trigger.id as string, ...trigger };
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

async function flushAcceptedUpdateWork() {
  await Promise.resolve();
  await Promise.resolve();
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
        container: { id: 'c1', notificationTriggerInclude: ' notify:patch , slack.alert : all ' },
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
          notificationTriggerInclude: 'slack.notify:major',
          notificationTriggerExclude: 'notify',
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
          notificationTriggerInclude: 'slack.alert:major',
        },
        triggerMap: {
          'slack.notify': createTrigger({ id: 'slack.notify', name: 'notify' }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: [], total: 0 });
    });

    test('parses each trigger against the list scoped to its own category (#494)', async () => {
      const harness = createHarness({
        container: {
          id: 'c1',
          actionTriggerInclude: 'docker.local',
          notificationTriggerInclude: 'slack.notify',
          triggerInclude: 'docker.local',
        },
        triggerMap: {
          'docker.local': createTrigger({ id: 'docker.local', type: 'docker', name: 'local' }),
          'slack.notify': createTrigger({ id: 'slack.notify', type: 'slack', name: 'notify' }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((trigger) => trigger.id).sort()).toEqual([
        'docker.local',
        'slack.notify',
      ]);
    });

    test('an action-only include list leaves notification triggers ungated (#494)', async () => {
      const harness = createHarness({
        container: {
          id: 'c1',
          actionTriggerInclude: 'docker.local',
          triggerInclude: 'docker.local',
        },
        triggerMap: {
          'docker.local': createTrigger({ id: 'docker.local', type: 'docker', name: 'local' }),
          'slack.notify': createTrigger({ id: 'slack.notify', type: 'slack', name: 'notify' }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(payload.data.map((trigger) => trigger.id).sort()).toEqual([
        'docker.local',
        'slack.notify',
      ]);
    });

    test('excludes triggers when only an exclude list is configured', async () => {
      const harness = createHarness({
        container: {
          id: 'c1',
          notificationTriggerExclude: 'notify',
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

  describe('getContainerTriggers — resolvedState', () => {
    test('resolves auto for a docker trigger with the legacy default auto mode', async () => {
      const harness = createHarness({
        container: { id: 'c1' },
        triggerMap: {
          'docker.update': createTrigger({ id: 'docker.update', type: 'docker', name: 'update' }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(payload.data).toEqual([expect.objectContaining({ resolvedState: 'auto' })]);
    });

    test('resolves manual for a dockercompose trigger configured with AUTO=none', async () => {
      const harness = createHarness({
        container: { id: 'c1' },
        triggerMap: {
          'dockercompose.recreate': createTrigger({
            id: 'dockercompose.recreate',
            type: 'dockercompose',
            name: 'recreate',
            configuration: { auto: 'none' },
          }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(payload.data).toEqual([expect.objectContaining({ resolvedState: 'manual' })]);
    });

    test('resolves blocked for an oninclude docker trigger the container has no include label for', async () => {
      // resolveTriggerAssociation only gates on an actual include/exclude label being
      // present, so an AUTO=oninclude trigger with no `dd.action.include` still appears
      // in the list (association isn't auto-mode aware) — resolvedState is what tells a
      // consumer this listed trigger is actually closed by default.
      const harness = createHarness({
        container: { id: 'c1' },
        triggerMap: {
          'docker.update': createTrigger({
            id: 'docker.update',
            type: 'docker',
            name: 'update',
            configuration: { auto: 'oninclude' },
          }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(payload.data).toEqual([expect.objectContaining({ resolvedState: 'blocked' })]);
    });

    test('resolves auto for onauto when the auto label matches, manual when only include matches', async () => {
      const harnessAuto = createHarness({
        container: { id: 'c1', actionTriggerAuto: 'docker.update' },
        triggerMap: {
          'docker.update': createTrigger({
            id: 'docker.update',
            type: 'docker',
            name: 'update',
            configuration: { auto: 'onauto' },
          }),
        },
      });
      const resAuto = await callGetContainerTriggers(harnessAuto.handlers);
      expect(resAuto.json.mock.calls[0][0].data).toEqual([
        expect.objectContaining({ resolvedState: 'auto' }),
      ]);

      const harnessManual = createHarness({
        container: { id: 'c1', actionTriggerInclude: 'docker.update' },
        triggerMap: {
          'docker.update': createTrigger({
            id: 'docker.update',
            type: 'docker',
            name: 'update',
            configuration: { auto: 'onauto' },
          }),
        },
      });
      const resManual = await callGetContainerTriggers(harnessManual.handlers);
      expect(resManual.json.mock.calls[0][0].data).toEqual([
        expect.objectContaining({ resolvedState: 'manual' }),
      ]);
    });

    test('falls back to the type/name id and the associated copy when unregistered in triggerMap', async () => {
      const triggerWithoutId = createTrigger({
        id: undefined,
        type: 'docker',
        name: 'orphan',
        configuration: { auto: 'none' },
      });
      const harness = createHarness({
        container: { id: 'c1' },
        triggerMap: {},
      });
      harness.deps.mapComponentsToList.mockReturnValue([triggerWithoutId]);

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(payload.data).toEqual([expect.objectContaining({ resolvedState: 'manual' })]);
    });

    test('leaves resolvedState unset for non-update-action triggers (notification/command)', async () => {
      const harness = createHarness({
        container: { id: 'c1' },
        triggerMap: {
          'slack.notify': createTrigger({ id: 'slack.notify', type: 'slack', name: 'notify' }),
        },
      });

      const res = await callGetContainerTriggers(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(payload.data).toHaveLength(1);
      expect('resolvedState' in payload.data[0]).toBe(false);
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

    test('accepts docker update triggers and returns an operation id', async () => {
      const trigger = createTrigger({
        id: 'docker.update',
        type: 'docker',
        name: 'update',
        trigger: vi.fn().mockResolvedValue(undefined),
      });
      const harness = createHarness({
        container: {
          id: 'c1',
          name: 'nginx',
          image: { name: 'nginx' },
          updateAvailable: true,
        },
        triggerMap: {
          'docker.update': trigger,
        },
      });

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerType: 'docker',
        triggerName: 'update',
      });
      await flushAcceptedUpdateWork();

      expect(trigger.trigger).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx' }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ operationId: expect.any(String) });
    });

    test('surfaces UpdateRequestError responses from accepted docker update triggers', async () => {
      const trigger = createTrigger({
        id: 'docker.update',
        type: 'docker',
        name: 'update',
        trigger: vi.fn().mockResolvedValue(undefined),
      });
      const harness = createHarness({
        container: {
          id: 'c1',
          name: 'nginx',
          image: { name: 'nginx' },
          updateAvailable: true,
        },
        triggerMap: {
          'docker.update': trigger,
        },
      });
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdate')
        .mockRejectedValueOnce(new requestUpdate.UpdateRequestError(418, 'teapot'));

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerType: 'docker',
        triggerName: 'update',
      });
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(418);
      expect(res.json).toHaveBeenCalledWith({ error: 'teapot' });
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

    test('falls back to a synthesized error when getErrorMessage returns an empty string', async () => {
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
      harness.deps.getErrorMessage.mockReturnValue('');

      const res = await callRunTrigger(harness.handlers, {
        id: 'c1',
        triggerType: 'slack',
        triggerName: 'notify',
      });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when running trigger (type=slack, name=notify)',
      });
    });

    test('should scrub credentials embedded in the thrown error message before sending to the client', async () => {
      const trigger = createTrigger({
        id: 'slack.notify',
        name: 'notify',
        trigger: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'Webhook call failed: Authorization: Bearer sk-secret-abc123, POST https://user:hunter2@hooks.example.com/notify timed out',
            ),
          ),
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

      expect(res.status).toHaveBeenCalledWith(500);
      const responseBody = JSON.stringify(res.json.mock.calls[0][0]);
      expect(responseBody).not.toContain('sk-secret-abc123');
      expect(responseBody).not.toContain('hunter2');
    });
  });
});
