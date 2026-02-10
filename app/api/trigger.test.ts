// @ts-nocheck
import { createMockResponse } from '../test/helpers.js';

const { mockRouter } = vi.hoisted(() => ({
    mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

vi.mock('express', () => ({
    default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('./component', () => ({
    init: vi.fn(() => mockRouter),
}));

vi.mock('../registry', () => ({
    getState: vi.fn(() => ({
        trigger: {},
    })),
}));

vi.mock('../agent', () => ({
    getAgent: vi.fn(),
}));

vi.mock('../log', () => ({ default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) } }));

import * as registry from '../registry/index.js';
import * as agent from '../agent/index.js';
import { runTrigger } from './trigger.js';
import * as triggerRouter from './trigger.js';

function createResponse() {
    return createMockResponse();
}

function getRemoteTriggerHandler() {
    triggerRouter.init();
    const call = mockRouter.post.mock.calls.find(
        (c) => c[0] === '/:agent/:type/:name',
    );
    return call[1];
}

describe('Trigger Router', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('init', () => {
        test('should register POST routes for triggers', () => {
            const router = triggerRouter.init();
            expect(router.post).toHaveBeenCalledWith(
                '/:type/:name',
                expect.any(Function),
            );
            expect(router.post).toHaveBeenCalledWith(
                '/:agent/:type/:name',
                expect.any(Function),
            );
        });
    });

    describe('runTrigger', () => {
        test('should return 400 when no container in body', async () => {
            const req = {
                params: { type: 'slack', name: 'default' },
                body: undefined,
            };
            const res = createResponse();

            await runTrigger(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('container is undefined'),
                }),
            );
        });

        test('should return 400 when container has agent (remote)', async () => {
            const req = {
                params: { type: 'slack', name: 'default' },
                body: { id: 'c1', agent: 'remote-agent' },
            };
            const res = createResponse();

            await runTrigger(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('Cannot execute local trigger'),
                }),
            );
        });

        test('should return 404 when trigger not found', async () => {
            registry.getState.mockReturnValue({ trigger: {} });

            const req = {
                params: { type: 'slack', name: 'default' },
                body: { id: 'c1' },
            };
            const res = createResponse();

            await runTrigger(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('trigger not found'),
                }),
            );
        });

        test('should run trigger successfully', async () => {
            const mockTrigger = {
                trigger: vi.fn().mockResolvedValue(undefined),
            };
            registry.getState.mockReturnValue({
                trigger: { 'slack.default': mockTrigger },
            });

            const req = {
                params: { type: 'slack', name: 'default' },
                body: { id: 'c1' },
            };
            const res = createResponse();

            await runTrigger(req, res);

            expect(mockTrigger.trigger).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'c1' }),
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should set default updateKind when missing', async () => {
            const mockTrigger = {
                trigger: vi.fn().mockResolvedValue(undefined),
            };
            registry.getState.mockReturnValue({
                trigger: { 'slack.default': mockTrigger },
            });

            const container = { id: 'c1' };
            const req = {
                params: { type: 'slack', name: 'default' },
                body: container,
            };
            const res = createResponse();

            await runTrigger(req, res);

            expect(mockTrigger.trigger).toHaveBeenCalledWith(
                expect.objectContaining({
                    updateKind: {
                        kind: 'unknown',
                        localValue: undefined,
                        remoteValue: undefined,
                        semverDiff: 'unknown',
                    },
                }),
            );
        });

        test('should not override existing updateKind', async () => {
            const mockTrigger = {
                trigger: vi.fn().mockResolvedValue(undefined),
            };
            registry.getState.mockReturnValue({
                trigger: { 'slack.default': mockTrigger },
            });

            const container = {
                id: 'c1',
                updateKind: { kind: 'tag', remoteValue: '2.0', localValue: '1.0', semverDiff: 'major' },
            };
            const req = {
                params: { type: 'slack', name: 'default' },
                body: container,
            };
            const res = createResponse();

            await runTrigger(req, res);

            expect(mockTrigger.trigger).toHaveBeenCalledWith(
                expect.objectContaining({
                    updateKind: { kind: 'tag', remoteValue: '2.0', localValue: '1.0', semverDiff: 'major' },
                }),
            );
        });

        test('should return 500 when trigger throws', async () => {
            const mockTrigger = {
                trigger: vi.fn().mockRejectedValue(new Error('trigger failed')),
            };
            registry.getState.mockReturnValue({
                trigger: { 'slack.default': mockTrigger },
            });

            const req = {
                params: { type: 'slack', name: 'default' },
                body: { id: 'c1' },
            };
            const res = createResponse();

            await runTrigger(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('trigger failed'),
                }),
            );
        });
    });

    describe('runRemoteTrigger', () => {
        test('should return 404 when agent not found', async () => {
            agent.getAgent.mockReturnValue(undefined);

            const handler = getRemoteTriggerHandler();
            const req = {
                params: { agent: 'unknown', type: 'slack', name: 'default' },
                body: { id: 'c1' },
            };
            const res = createResponse();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('Agent unknown not found'),
                }),
            );
        });

        test('should return 400 when no container in body', async () => {
            agent.getAgent.mockReturnValue({ runRemoteTrigger: vi.fn() });

            const handler = getRemoteTriggerHandler();
            const req = {
                params: { agent: 'my-agent', type: 'slack', name: 'default' },
                body: undefined,
            };
            const res = createResponse();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('should return 400 when container has no id', async () => {
            agent.getAgent.mockReturnValue({ runRemoteTrigger: vi.fn() });

            const handler = getRemoteTriggerHandler();
            const req = {
                params: { agent: 'my-agent', type: 'slack', name: 'default' },
                body: { name: 'test' },
            };
            const res = createResponse();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('should run remote trigger successfully', async () => {
            const mockAgentClient = {
                runRemoteTrigger: vi.fn().mockResolvedValue(undefined),
            };
            agent.getAgent.mockReturnValue(mockAgentClient);

            const handler = getRemoteTriggerHandler();
            const req = {
                params: { agent: 'my-agent', type: 'slack', name: 'default' },
                body: { id: 'c1' },
            };
            const res = createResponse();

            await handler(req, res);

            expect(mockAgentClient.runRemoteTrigger).toHaveBeenCalledWith(
                { id: 'c1' },
                'slack',
                'default',
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('should return 500 when remote trigger throws', async () => {
            const mockAgentClient = {
                runRemoteTrigger: vi
                    .fn()
                    .mockRejectedValue(new Error('remote error')),
            };
            agent.getAgent.mockReturnValue(mockAgentClient);

            const handler = getRemoteTriggerHandler();
            const req = {
                params: { agent: 'my-agent', type: 'slack', name: 'default' },
                body: { id: 'c1' },
            };
            const res = createResponse();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('remote error'),
                }),
            );
        });
    });
});
