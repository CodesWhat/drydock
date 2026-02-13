// @ts-nocheck
import * as event from './index.js';

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
test.each(
  eventTestCases,
)('the registered $register.name function must execute the handler when the $emitter.name emitter function is called', async ({
  register,
  emitter,
}) => {
  // Register an handler
  const handlerMock = vi.fn((item) => item);
  register(handlerMock);

  // Emit the event
  const emitResult = await emitter();

  // Ensure handler is called
  expect([undefined, true, false]).toContain(emitResult);
  expect(handlerMock).toHaveBeenCalledTimes(1);
});

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

test('container report handlers with same order and id should run by registration sequence', async () => {
  const calls: string[] = [];
  event.registerContainerReport(
    async () => {
      calls.push('first');
    },
    { id: 'same.id', order: 10 },
  );
  event.registerContainerReport(
    async () => {
      calls.push('second');
    },
    { id: 'same.id', order: 10 },
  );

  await event.emitContainerReport({});

  expect(calls).toEqual(['first', 'second']);
});

test('deregistration function should remove handler', async () => {
  const handler = vi.fn();
  const deregister = event.registerContainerReport(handler, { order: 10 });

  deregister();

  await event.emitContainerReport({});
  expect(handler).not.toHaveBeenCalled();
});

test('deregistration function should be idempotent', async () => {
  const handler = vi.fn();
  const deregister = event.registerContainerReport(handler, { order: 10 });
  deregister();
  deregister();
  await event.emitContainerReport({});
  expect(handler).not.toHaveBeenCalled();
});

test('emitContainerUpdateApplied should call registered handlers', async () => {
  const handler = vi.fn();
  event.registerContainerUpdateApplied(handler, { order: 10 });
  await event.emitContainerUpdateApplied('container-123');
  expect(handler).toHaveBeenCalledWith('container-123');
});

test('deregistration of containerUpdateApplied handler should work', async () => {
  const handler = vi.fn();
  const deregister = event.registerContainerUpdateApplied(handler, { order: 10 });
  deregister();
  await event.emitContainerUpdateApplied('container-456');
  expect(handler).not.toHaveBeenCalled();
});

test('handler with non-finite order should default to 100', async () => {
  const calls: string[] = [];
  event.registerContainerReport(
    async () => {
      calls.push('low-order');
    },
    { order: 50 },
  );
  event.registerContainerReport(
    async () => {
      calls.push('default-order');
    },
    { order: Number.NaN },
  );

  await event.emitContainerReport({});

  expect(calls).toEqual(['low-order', 'default-order']);
});

test('container-added audit handler should fall back to id when name is missing', async () => {
  vi.resetModules();
  const insertAudit = vi.fn();
  const inc = vi.fn();

  vi.doMock('../store/audit.js', () => ({
    insertAudit,
  }));
  vi.doMock('../prometheus/audit.js', () => ({
    getAuditCounter: () => ({
      inc,
    }),
  }));

  const freshEvent = await import('./index.js');
  freshEvent.emitContainerAdded({
    id: 'container-id-only',
    image: {
      name: 'nginx',
    },
  });

  expect(insertAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'container-added',
      containerName: 'container-id-only',
      containerImage: 'nginx',
    }),
  );
  expect(inc).toHaveBeenCalledWith({ action: 'container-added' });
});

test('container-added audit handler should fallback to empty string when name and id are missing', async () => {
  vi.resetModules();
  const insertAudit = vi.fn();

  vi.doMock('../store/audit.js', () => ({
    insertAudit,
  }));
  vi.doMock('../prometheus/audit.js', () => ({
    getAuditCounter: () => undefined,
  }));

  const freshEvent = await import('./index.js');
  freshEvent.emitContainerAdded({
    image: {
      name: 'nginx',
    },
  });

  expect(insertAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'container-added',
      containerName: '',
      containerImage: 'nginx',
    }),
  );
});
