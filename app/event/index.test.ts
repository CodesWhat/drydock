// @ts-nocheck
import * as event from './index';

beforeEach(() => {
    event.clearAllListenersForTests();
});

const eventTestCases = [
    {
        emitter: event.emitContainerReports,
        register: event.registerContainerReports,
    },
    {
        emitter: event.emitContainerReport,
        register: event.registerContainerReport,
    },
    {
        emitter: event.emitContainerAdded,
        register: event.registerContainerAdded,
    },
    {
        emitter: event.emitContainerUpdated,
        register: event.registerContainerUpdated,
    },
    {
        emitter: event.emitContainerRemoved,
        register: event.registerContainerRemoved,
    },
    {
        emitter: event.emitWatcherStart,
        register: event.registerWatcherStart,
    },
    {
        emitter: event.emitWatcherStop,
        register: event.registerWatcherStop,
    },
];
test.each(eventTestCases)(
    'the registered $register.name function must execute the handler when the $emitter.name emitter function is called',
    async ({ register, emitter }) => {
        // Register an handler
        const handlerMock = jest.fn((item) => item);
        register(handlerMock);

        // Emit the event
        await emitter();

        // Ensure handler is called
        expect(handlerMock.mock.calls.length === 1);
    },
);

test('container report handlers should run in order', async () => {
    const calls: string[] = [];
    event.registerContainerReport(
        async () => {
            calls.push('docker');
        },
        { id: 'docker.update', order: 10 },
    );
    event.registerContainerReport(
        async () => {
            calls.push('discord');
        },
        { id: 'discord.update', order: 20 },
    );

    await event.emitContainerReport({});

    expect(calls).toEqual(['docker', 'discord']);
});

test('container report handlers with same order should run by id', async () => {
    const calls: string[] = [];
    event.registerContainerReport(
        async () => {
            calls.push('discord');
        },
        { id: 'discord.update', order: 20 },
    );
    event.registerContainerReport(
        async () => {
            calls.push('docker');
        },
        { id: 'docker.update', order: 20 },
    );

    await event.emitContainerReport({});

    expect(calls).toEqual(['discord', 'docker']);
});
