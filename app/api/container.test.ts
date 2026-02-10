// @ts-nocheck
import { createMockResponse } from '../test/helpers.js';

const { mockRouter } = vi.hoisted(() => ({
    mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

vi.mock('express', () => ({
    default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container', () => ({
    getContainers: vi.fn(() => []),
    getContainer: vi.fn(),
    updateContainer: vi.fn((container) => container),
    deleteContainer: vi.fn(),
}));

vi.mock('../registry', () => ({
    getState: vi.fn(() => ({
        watcher: {},
        trigger: {},
    })),
}));

vi.mock('../configuration', () => ({
    getServerConfiguration: vi.fn(() => ({
        feature: { delete: true },
    })),
}));

vi.mock('./component', () => ({
    mapComponentsToList: vi.fn(() => []),
}));

vi.mock('../triggers/providers/Trigger', () => ({
    __esModule: true,
    default: {
        parseIncludeOrIncludeTriggerString: vi.fn((str) => ({ id: str })),
        doesReferenceMatchId: vi.fn(() => false),
    },
}));

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn() })) } }));

vi.mock('../agent/manager', () => ({
    getAgent: vi.fn(),
}));

import * as storeContainer from '../store/container.js';
import * as registry from '../registry/index.js';
import { getServerConfiguration } from '../configuration/index.js';
import { mapComponentsToList } from './component.js';
import Trigger from '../triggers/providers/Trigger.js';
import { getAgent } from '../agent/manager.js';
import * as containerRouter from './container.js';

function createResponse() {
    return createMockResponse();
}

function getHandler(method, path) {
    containerRouter.init();
    const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
    return call[1];
}

/** Helper: invoke deleteContainer with a given container id and return the response mock */
async function callDeleteContainer(id = 'c1') {
    const res = createResponse();
    await containerRouter.deleteContainer({ params: { id } }, res);
    return res;
}

/** Helper: set up a remote container with a mock agent and call deleteContainer */
async function callDeleteRemoteContainer(agentSetup) {
    storeContainer.getContainer.mockReturnValue({ id: 'c1', agent: 'remote' });
    if (agentSetup) {
        getAgent.mockReturnValue(agentSetup);
    } else {
        getAgent.mockReturnValue(undefined);
    }
    return callDeleteContainer();
}

/** Helper: invoke the runTrigger handler (3-segment route) */
async function callRunTrigger(params) {
    const handler = getHandler('post', '/:id/triggers/:triggerType/:triggerName');
    const res = createResponse();
    await handler({ params }, res);
    return res;
}

/** Helper: invoke patchContainerUpdatePolicy handler */
function callUpdatePolicy(container, body) {
    storeContainer.getContainer.mockReturnValue(container);
    containerRouter.init();
    const route = mockRouter.patch.mock.calls.find((call) => call[0] === '/:id/update-policy');
    const handler = route[1];
    const res = createResponse();
    handler({ params: { id: container?.id ?? 'missing' }, body }, res);
    return res;
}

/** Helper: invoke watchContainer handler */
async function callWatchContainer(id = 'c1') {
    const handler = getHandler('post', '/:id/watch');
    const res = createResponse();
    await handler({ params: { id } }, res);
    return res;
}

/** Helper: set up trigger filter test scenario */
async function callGetContainerTriggers(container, triggers) {
    storeContainer.getContainer.mockReturnValue(container);
    mapComponentsToList.mockReturnValue(triggers);
    const res = createResponse();
    await containerRouter.getContainerTriggers({ params: { id: container.id } }, res);
    return res;
}

/** Extract the triggers array from a response json call */
function getTriggersFromResponse(res) {
    return res.json.mock.calls[0][0];
}

/** Get the updatePolicy from the first updateContainer call */
function getUpdatedPolicy() {
    return storeContainer.updateContainer.mock.calls[0][0].updatePolicy;
}

describe('Container Router', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
    });

    describe('init', () => {
        test('should register all routes', () => {
            const router = containerRouter.init();
            expect(router.use).toHaveBeenCalledWith('nocache-middleware');
            expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
            expect(router.post).toHaveBeenCalledWith('/watch', expect.any(Function));
            expect(router.get).toHaveBeenCalledWith('/:id', expect.any(Function));
            expect(router.delete).toHaveBeenCalledWith('/:id', expect.any(Function));
            expect(router.get).toHaveBeenCalledWith('/:id/triggers', expect.any(Function));
            expect(router.post).toHaveBeenCalledWith('/:id/triggers/:triggerType/:triggerName', expect.any(Function));
            expect(router.post).toHaveBeenCalledWith('/:id/triggers/:triggerAgent/:triggerType/:triggerName', expect.any(Function));
            expect(router.patch).toHaveBeenCalledWith('/:id/update-policy', expect.any(Function));
            expect(router.post).toHaveBeenCalledWith('/:id/watch', expect.any(Function));
        });
    });

    describe('getContainers', () => {
        test('should return containers from store', () => {
            storeContainer.getContainers.mockReturnValue([{ id: 'c1' }]);
            const handler = getHandler('get', '/');
            const res = createResponse();
            handler({ query: {} }, res);

            expect(storeContainer.getContainers).toHaveBeenCalledWith({});
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith([{ id: 'c1' }]);
        });
    });

    describe('getContainersFromStore', () => {
        test('should delegate to store getContainers', () => {
            storeContainer.getContainers.mockReturnValue([{ id: 'c1' }]);
            const result = containerRouter.getContainersFromStore({ watcher: 'docker' });
            expect(storeContainer.getContainers).toHaveBeenCalledWith({ watcher: 'docker' });
            expect(result).toEqual([{ id: 'c1' }]);
        });
    });

    describe('getContainer', () => {
        test('should return container when found', () => {
            storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'test' });
            const handler = getHandler('get', '/:id');
            const res = createResponse();
            handler({ params: { id: 'c1' } }, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ id: 'c1', name: 'test' });
        });

        test('should return 404 when container not found', () => {
            storeContainer.getContainer.mockReturnValue(undefined);
            const handler = getHandler('get', '/:id');
            const res = createResponse();
            handler({ params: { id: 'missing' } }, res);

            expect(res.sendStatus).toHaveBeenCalledWith(404);
        });
    });

    describe('deleteContainer', () => {
        test('should return 403 when delete feature is disabled', async () => {
            getServerConfiguration.mockReturnValue({ feature: { delete: false } });
            const res = await callDeleteContainer();
            expect(res.sendStatus).toHaveBeenCalledWith(403);
        });

        test('should return 404 when container not found', async () => {
            getServerConfiguration.mockReturnValue({ feature: { delete: true } });
            storeContainer.getContainer.mockReturnValue(undefined);
            const res = await callDeleteContainer();
            expect(res.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should delete local container and return 204', async () => {
            getServerConfiguration.mockReturnValue({ feature: { delete: true } });
            storeContainer.getContainer.mockReturnValue({ id: 'c1' });
            const res = await callDeleteContainer();
            expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
            expect(res.sendStatus).toHaveBeenCalledWith(204);
        });

        test('should return 500 when agent not found for remote container', async () => {
            getServerConfiguration.mockReturnValue({ feature: { delete: true } });
            const res = await callDeleteRemoteContainer(undefined);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining('Agent remote not found'),
            }));
        });

        test('should delete remote container successfully', async () => {
            getServerConfiguration.mockReturnValue({ feature: { delete: true } });
            const mockAgentObj = { deleteContainer: vi.fn().mockResolvedValue(undefined) };
            const res = await callDeleteRemoteContainer(mockAgentObj);
            expect(mockAgentObj.deleteContainer).toHaveBeenCalledWith('c1');
            expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
            expect(res.sendStatus).toHaveBeenCalledWith(204);
        });

        test('should handle 404 from agent delete and still clean up', async () => {
            getServerConfiguration.mockReturnValue({ feature: { delete: true } });
            const error = new Error('Not found');
            error.response = { status: 404 };
            const mockAgentObj = { deleteContainer: vi.fn().mockRejectedValue(error) };
            const res = await callDeleteRemoteContainer(mockAgentObj);
            expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
            expect(res.sendStatus).toHaveBeenCalledWith(204);
        });

        test('should return 500 on agent delete error (non-404)', async () => {
            getServerConfiguration.mockReturnValue({ feature: { delete: true } });
            const error = new Error('Server error');
            error.response = { status: 500 };
            const mockAgentObj = { deleteContainer: vi.fn().mockRejectedValue(error) };
            const res = await callDeleteRemoteContainer(mockAgentObj);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining('Error deleting container on agent'),
            }));
        });

        test('should handle agent delete error without response', async () => {
            getServerConfiguration.mockReturnValue({ feature: { delete: true } });
            const error = new Error('Network error');
            const mockAgentObj = { deleteContainer: vi.fn().mockRejectedValue(error) };
            const res = await callDeleteRemoteContainer(mockAgentObj);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('watchContainers', () => {
        test('should watch all watchers and return containers', async () => {
            const mockWatcher = { watch: vi.fn().mockResolvedValue(undefined) };
            registry.getState.mockReturnValue({
                watcher: { 'docker.local': mockWatcher },
                trigger: {},
            });
            storeContainer.getContainers.mockReturnValue([{ id: 'c1' }]);

            const handler = getHandler('post', '/watch');
            const res = createResponse();
            await handler({ query: {} }, res);

            expect(mockWatcher.watch).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should return 500 when watcher fails', async () => {
            const mockWatcher = { watch: vi.fn().mockRejectedValue(new Error('watch failed')) };
            registry.getState.mockReturnValue({
                watcher: { 'docker.local': mockWatcher },
                trigger: {},
            });

            const handler = getHandler('post', '/watch');
            const res = createResponse();
            await handler({ query: {} }, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining('watch failed'),
            }));
        });
    });

    describe('getContainerTriggers', () => {
        test('should return 404 when container not found', async () => {
            storeContainer.getContainer.mockReturnValue(undefined);
            const res = createResponse();
            await containerRouter.getContainerTriggers({ params: { id: 'missing' } }, res);
            expect(res.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should return associated triggers for container', async () => {
            const res = await callGetContainerTriggers(
                { id: 'c1' },
                [{ type: 'slack', name: 'default', configuration: {} }],
            );
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.any(Array));
        });

        test('should filter triggers with triggerInclude', async () => {
            Trigger.parseIncludeOrIncludeTriggerString.mockReturnValue({ id: 'slack.default' });
            Trigger.doesReferenceMatchId.mockImplementation((ref, id) => ref === id);
            const res = await callGetContainerTriggers(
                { id: 'c1', triggerInclude: 'slack.default' },
                [
                    { type: 'slack', name: 'default', configuration: {} },
                    { type: 'email', name: 'default', configuration: {} },
                ],
            );

            expect(res.status).toHaveBeenCalledWith(200);
            const triggers = getTriggersFromResponse(res);
            expect(triggers).toHaveLength(1);
            expect(triggers[0].type).toBe('slack');
        });

        test('should filter triggers with triggerExclude', async () => {
            Trigger.parseIncludeOrIncludeTriggerString.mockReturnValue({ id: 'slack.default' });
            Trigger.doesReferenceMatchId.mockImplementation((ref, id) => ref === id);
            const res = await callGetContainerTriggers(
                { id: 'c1', triggerExclude: 'slack.default' },
                [
                    { type: 'slack', name: 'default', configuration: {} },
                    { type: 'email', name: 'default', configuration: {} },
                ],
            );

            expect(res.status).toHaveBeenCalledWith(200);
            const triggers = getTriggersFromResponse(res);
            expect(triggers).toHaveLength(1);
            expect(triggers[0].type).toBe('email');
        });

        test('should exclude remote triggers for different agent', async () => {
            const res = await callGetContainerTriggers(
                { id: 'c1', agent: 'agent-1' },
                [{ type: 'slack', name: 'default', configuration: {}, agent: 'agent-2' }],
            );
            expect(getTriggersFromResponse(res)).toHaveLength(0);
        });

        test('should exclude local docker triggers for remote containers', async () => {
            const res = await callGetContainerTriggers(
                { id: 'c1', agent: 'agent-1' },
                [
                    { type: 'docker', name: 'default', configuration: {} },
                    { type: 'dockercompose', name: 'default', configuration: {} },
                ],
            );
            expect(getTriggersFromResponse(res)).toHaveLength(0);
        });

        test('should include triggers with matching include threshold', async () => {
            Trigger.parseIncludeOrIncludeTriggerString.mockReturnValue({ id: 'slack.default', threshold: 'all' });
            Trigger.doesReferenceMatchId.mockReturnValue(true);
            const res = await callGetContainerTriggers(
                { id: 'c1', triggerInclude: 'slack.default(all)' },
                [{ type: 'slack', name: 'default', configuration: {} }],
            );

            const triggers = getTriggersFromResponse(res);
            expect(triggers).toHaveLength(1);
            expect(triggers[0].configuration.threshold).toBe('all');
        });
    });

    describe('runTrigger', () => {
        test('should return 404 when container not found', async () => {
            storeContainer.getContainer.mockReturnValue(undefined);
            const res = await callRunTrigger({ id: 'missing', triggerType: 'slack', triggerName: 'default' });
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Container not found' }));
        });

        test.each(['docker', 'dockercompose'])(
            'should return 400 for local %s trigger on remote container',
            async (triggerType) => {
                storeContainer.getContainer.mockReturnValue({ id: 'c1', agent: 'remote' });
                const res = await callRunTrigger({ id: 'c1', triggerType, triggerName: 'restart' });
                expect(res.status).toHaveBeenCalledWith(400);
            },
        );

        test('should return 404 when trigger not found', async () => {
            storeContainer.getContainer.mockReturnValue({ id: 'c1' });
            registry.getState.mockReturnValue({ watcher: {}, trigger: {} });
            const res = await callRunTrigger({ id: 'c1', triggerType: 'slack', triggerName: 'default' });
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Trigger not found' }));
        });

        test('should run trigger successfully', async () => {
            const mockTrigger = { trigger: vi.fn().mockResolvedValue(undefined) };
            storeContainer.getContainer.mockReturnValue({ id: 'c1' });
            registry.getState.mockReturnValue({ watcher: {}, trigger: { 'slack.default': mockTrigger } });
            const res = await callRunTrigger({ id: 'c1', triggerType: 'slack', triggerName: 'default' });
            expect(mockTrigger.trigger).toHaveBeenCalledWith({ id: 'c1' });
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should return 500 when trigger execution fails', async () => {
            const mockTrigger = { trigger: vi.fn().mockRejectedValue(new Error('trigger error')) };
            storeContainer.getContainer.mockReturnValue({ id: 'c1' });
            registry.getState.mockReturnValue({ watcher: {}, trigger: { 'slack.default': mockTrigger } });
            const res = await callRunTrigger({ id: 'c1', triggerType: 'slack', triggerName: 'default' });
            expect(res.status).toHaveBeenCalledWith(500);
        });

        test('should use triggerAgent in trigger id when provided', async () => {
            const mockTrigger = { trigger: vi.fn().mockResolvedValue(undefined) };
            storeContainer.getContainer.mockReturnValue({ id: 'c1' });
            registry.getState.mockReturnValue({ watcher: {}, trigger: { 'myagent.slack.default': mockTrigger } });
            const handler = getHandler('post', '/:id/triggers/:triggerAgent/:triggerType/:triggerName');
            const res = createResponse();
            await handler({ params: { id: 'c1', triggerAgent: 'myagent', triggerType: 'slack', triggerName: 'default' } }, res);
            expect(mockTrigger.trigger).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('watchContainer', () => {
        test('should return 404 when container not found', async () => {
            storeContainer.getContainer.mockReturnValue(undefined);
            const res = await callWatchContainer('missing');
            expect(res.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should return 500 when watcher not found', async () => {
            storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: {}, trigger: {} });
            const res = await callWatchContainer();
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('No provider found') }));
        });

        test('should use agent prefix for watcher id when container has agent', async () => {
            storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local', agent: 'remote' });
            registry.getState.mockReturnValue({ watcher: {}, trigger: {} });
            const res = await callWatchContainer();
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('remote.docker.local') }));
        });

        test('should watch container successfully', async () => {
            const mockWatcher = {
                watchContainer: vi.fn().mockResolvedValue({ container: { id: 'c1', result: {} } }),
            };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            const res = await callWatchContainer();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ id: 'c1', result: {} });
        });

        test('should return 500 when watch fails', async () => {
            const mockWatcher = {
                watchContainer: vi.fn().mockRejectedValue(new Error('watch error')),
            };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            const res = await callWatchContainer();
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('watch error') }));
        });

        test('should check getContainers and return 404 when container not in list', async () => {
            const mockWatcher = {
                getContainers: vi.fn().mockResolvedValue([{ id: 'other' }]),
                watchContainer: vi.fn(),
            };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            const res = await callWatchContainer();
            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('should proceed when container is found in getContainers list', async () => {
            const mockWatcher = {
                getContainers: vi.fn().mockResolvedValue([{ id: 'c1' }]),
                watchContainer: vi.fn().mockResolvedValue({ container: { id: 'c1' } }),
            };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            const res = await callWatchContainer();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('patchContainerUpdatePolicy', () => {
        test('should return 404 when container not found', () => {
            const res = callUpdatePolicy(undefined, { action: 'clear' });
            expect(res.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should return 400 when no action provided', () => {
            const res = callUpdatePolicy({ id: 'c1' }, {});
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Action is required' }));
        });

        test('should handle missing body', () => {
            const res = callUpdatePolicy({ id: 'c1' }, undefined);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('should return 400 for unknown action', () => {
            const res = callUpdatePolicy({ id: 'c1' }, { action: 'unknown-action' });
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Unknown action') }));
        });

        test('should skip current tag update', () => {
            const res = callUpdatePolicy(
                { id: 'c1', updateKind: { kind: 'tag', remoteValue: '2.0.0' }, result: { tag: '2.0.0' } },
                { action: 'skip-current' },
            );
            expect(getUpdatedPolicy()).toEqual({ skipTags: ['2.0.0'] });
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should skip current digest update', () => {
            callUpdatePolicy(
                { id: 'c1', updateKind: { kind: 'digest', remoteValue: 'sha256:abc' }, result: { digest: 'sha256:abc' } },
                { action: 'skip-current' },
            );
            expect(getUpdatedPolicy()).toEqual({ skipDigests: ['sha256:abc'] });
        });

        test('should fall back to result.tag when remoteValue is missing', () => {
            callUpdatePolicy(
                { id: 'c1', updateKind: { kind: 'tag' }, result: { tag: '3.0.0' } },
                { action: 'skip-current' },
            );
            expect(getUpdatedPolicy()).toEqual({ skipTags: ['3.0.0'] });
        });

        test('should fall back to result.digest when remoteValue is missing', () => {
            callUpdatePolicy(
                { id: 'c1', updateKind: { kind: 'digest' }, result: { digest: 'sha256:def' } },
                { action: 'skip-current' },
            );
            expect(getUpdatedPolicy()).toEqual({ skipDigests: ['sha256:def'] });
        });

        test('should return 400 when updateKind is unknown', () => {
            const res = callUpdatePolicy(
                { id: 'c1', updateKind: { kind: 'unknown' }, result: { tag: '2.0.0' } },
                { action: 'skip-current' },
            );
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('No current update available') }));
        });

        test('should return 400 when no update value available', () => {
            const res = callUpdatePolicy(
                { id: 'c1', updateKind: { kind: 'tag' }, result: {} },
                { action: 'skip-current' },
            );
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('No update value available') }));
        });

        test('should clear skip tags and digests', () => {
            const res = callUpdatePolicy(
                { id: 'c1', updatePolicy: { skipTags: ['2.0.0'], skipDigests: ['sha256:abc'] } },
                { action: 'clear-skips' },
            );
            expect(getUpdatedPolicy()).toBeUndefined();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should snooze with default 7 days', () => {
            const res = callUpdatePolicy({ id: 'c1' }, { action: 'snooze' });
            expect(getUpdatedPolicy().snoozeUntil).toBeDefined();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should snooze with custom days', () => {
            const res = callUpdatePolicy({ id: 'c1' }, { action: 'snooze', days: 30 });
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should snooze with custom snoozeUntil date', () => {
            callUpdatePolicy({ id: 'c1' }, { action: 'snooze', snoozeUntil: '2099-01-01T00:00:00.000Z' });
            expect(getUpdatedPolicy().snoozeUntil).toBe('2099-01-01T00:00:00.000Z');
        });

        test.each([
            ['days is 0', { action: 'snooze', days: 0 }],
            ['days > 365', { action: 'snooze', days: 400 }],
            ['invalid snoozeUntil date', { action: 'snooze', snoozeUntil: 'not-a-date' }],
        ])('should return 400 when %s', (_label, body) => {
            const res = callUpdatePolicy({ id: 'c1' }, body);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('should remove snoozeUntil on unsnooze', () => {
            const res = callUpdatePolicy(
                { id: 'c1', updatePolicy: { snoozeUntil: '2099-01-01T00:00:00.000Z' } },
                { action: 'unsnooze' },
            );
            expect(getUpdatedPolicy()).toBeUndefined();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should clear entire update policy', () => {
            const res = callUpdatePolicy(
                { id: 'c1', updatePolicy: { skipTags: ['2.0.0'], snoozeUntil: '2099-01-01T00:00:00.000Z' } },
                { action: 'clear' },
            );
            expect(getUpdatedPolicy()).toBeUndefined();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should handle existing policy with dedup and valid data on skip-current', () => {
            callUpdatePolicy(
                {
                    id: 'c1',
                    updateKind: { kind: 'tag', remoteValue: '3.0.0' },
                    updatePolicy: { skipTags: ['1.0.0', '1.0.0', 123], skipDigests: ['sha256:abc', 'sha256:abc'], snoozeUntil: '2099-06-15T00:00:00.000Z' },
                },
                { action: 'skip-current' },
            );
            const policy = getUpdatedPolicy();
            expect(policy.skipTags).toEqual(['1.0.0', '3.0.0']);
            expect(policy.skipDigests).toEqual(['sha256:abc']);
            expect(policy.snoozeUntil).toBe('2099-06-15T00:00:00.000Z');
        });

        test('should ignore invalid snoozeUntil in existing policy', () => {
            callUpdatePolicy(
                { id: 'c1', updatePolicy: { snoozeUntil: 'not-a-date' } },
                { action: 'unsnooze' },
            );
            expect(getUpdatedPolicy()).toBeUndefined();
        });
    });
});
