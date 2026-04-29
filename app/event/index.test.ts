import * as event from './index.js';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: warnMock, error: vi.fn(), debug: vi.fn() }) },
}));

beforeEach(() => {
  event.clearAllListenersForTests();
  warnMock.mockClear();
  event.setHandlerTimeoutMsForTests(undefined);
});

const eventTestCases = [
  {
    emitter: event.emitContainerReports,
    register: event.registerContainerReports,
  },
  {
    emitter: event.emitWatcherSnapshot,
    register: event.registerWatcherSnapshot,
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
    emitter: event.emitUpdateOperationChanged,
    register: event.registerUpdateOperationChanged,
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

test('deregistration of container added handler should work', () => {
  const handler = vi.fn();
  const deregister = event.registerContainerAdded(handler);
  deregister();

  event.emitContainerAdded({ id: 'container-added-1' });

  expect(handler).not.toHaveBeenCalled();
});

test('deregistration of container updated handler should work', () => {
  const handler = vi.fn();
  const deregister = event.registerContainerUpdated(handler);
  deregister();

  event.emitContainerUpdated({ id: 'container-updated-1' });

  expect(handler).not.toHaveBeenCalled();
});

test('deregistration of container removed handler should work', () => {
  const handler = vi.fn();
  const deregister = event.registerContainerRemoved(handler);
  deregister();

  event.emitContainerRemoved({ id: 'container-removed-1' });

  expect(handler).not.toHaveBeenCalled();
});

test('deregistration of update operation changed handler should work', async () => {
  const handler = vi.fn();
  const deregister = event.registerUpdateOperationChanged(handler);
  deregister();

  await event.emitUpdateOperationChanged({ operationId: 'op-1' });

  expect(handler).not.toHaveBeenCalled();
});

test('deregistration of watcher start handler should work', () => {
  const handler = vi.fn();
  const deregister = event.registerWatcherStart(handler);
  deregister();

  event.emitWatcherStart({ name: 'watcher-start-1' });

  expect(handler).not.toHaveBeenCalled();
});

test('deregistration of watcher stop handler should work', () => {
  const handler = vi.fn();
  const deregister = event.registerWatcherStop(handler);
  deregister();

  event.emitWatcherStop({ name: 'watcher-stop-1' });

  expect(handler).not.toHaveBeenCalled();
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

test('deregister should remove the exact registration when the same handler is registered twice', async () => {
  const calls: string[] = [];
  const sharedHandler = async () => {
    calls.push('shared');
  };

  event.registerContainerReport(
    async () => {
      calls.push('middle');
    },
    { id: 'middle', order: 15 },
  );

  event.registerContainerReport(sharedHandler, { id: 'first', order: 10 });
  const deregisterSecond = event.registerContainerReport(sharedHandler, {
    id: 'second',
    order: 20,
  });

  deregisterSecond();
  await event.emitContainerReport({});

  expect(calls).toEqual(['shared', 'middle']);
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

test('getContainerUpdateAppliedEventContainerName should normalize supported payload shapes', () => {
  expect(event.getContainerUpdateAppliedEventContainerName('container-123')).toBe('container-123');
  expect(event.getContainerUpdateAppliedEventContainerName('')).toBeUndefined();
  expect(
    event.getContainerUpdateAppliedEventContainerName(null as unknown as string),
  ).toBeUndefined();
  expect(
    event.getContainerUpdateAppliedEventContainerName(42 as unknown as string),
  ).toBeUndefined();
  expect(
    event.getContainerUpdateAppliedEventContainerName({ containerName: '' } as {
      containerName: string;
    }),
  ).toBeUndefined();
  expect(
    event.getContainerUpdateAppliedEventContainerName({ containerName: 'web' } as {
      containerName: string;
    }),
  ).toBe('web');
});

test('emitContainerUpdateFailed should call registered handlers', async () => {
  const handler = vi.fn();
  const payload = {
    containerName: 'web',
    error: 'failed to recreate container',
  };
  event.registerContainerUpdateFailed(handler, { order: 10 });
  await event.emitContainerUpdateFailed(payload);
  expect(handler).toHaveBeenCalledWith(payload);
});

test('deregistration of containerUpdateFailed handler should work', async () => {
  const handler = vi.fn();
  const deregister = event.registerContainerUpdateFailed(handler, { order: 10 });
  deregister();
  await event.emitContainerUpdateFailed({
    containerName: 'api',
    error: 'update skipped',
  });
  expect(handler).not.toHaveBeenCalled();
});

test('emitSecurityAlert should call registered handlers with payload', async () => {
  const handler = vi.fn();
  const payload = {
    containerName: 'docker_local_nginx',
    details: 'high=1, critical=0',
    status: 'passed',
  };
  event.registerSecurityAlert(handler, { order: 10 });
  await event.emitSecurityAlert(payload);
  expect(handler).toHaveBeenCalledWith(payload);
});

test('deregistration of security alert handler should work', async () => {
  const handler = vi.fn();
  const deregister = event.registerSecurityAlert(handler, { order: 10 });
  deregister();
  await event.emitSecurityAlert({
    containerName: 'docker_local_nginx',
    details: 'high=2',
  });
  expect(handler).not.toHaveBeenCalled();
});

test('emitSecurityScanCycleComplete should call registered handlers with payload', async () => {
  const handler = vi.fn();
  const payload = {
    scannedCount: 12,
    alertCount: 3,
    cycleId: 'cycle-42',
    scope: 'scheduled' as const,
  };
  event.registerSecurityScanCycleComplete(handler, { order: 10 });
  await event.emitSecurityScanCycleComplete(payload);
  expect(handler).toHaveBeenCalledWith(payload);
});

test('deregistration of security scan cycle complete handler should work', async () => {
  const handler = vi.fn();
  const deregister = event.registerSecurityScanCycleComplete(handler, { order: 10 });
  deregister();
  await event.emitSecurityScanCycleComplete({ cycleId: 'cycle-1', scannedCount: 0 });
  expect(handler).not.toHaveBeenCalled();
});

test('emitAgentDisconnected should call registered handlers with payload', async () => {
  const handler = vi.fn();
  const payload = {
    agentName: 'edge-a',
    reason: 'SSE stream ended',
  };
  event.registerAgentDisconnected(handler, { order: 10 });
  await event.emitAgentDisconnected(payload);
  expect(handler).toHaveBeenCalledWith(payload);
});

test('emitAgentConnected should call registered handlers with payload', async () => {
  const handler = vi.fn();
  const payload = {
    agentName: 'edge-a',
    reconnected: false,
  };
  event.registerAgentConnected(handler, { order: 10 });
  await event.emitAgentConnected(payload);
  expect(handler).toHaveBeenCalledWith(payload);
});

test('deregistration of agent connected handler should work', async () => {
  const handler = vi.fn();
  const deregister = event.registerAgentConnected(handler, { order: 10 });
  deregister();
  await event.emitAgentConnected({
    agentName: 'edge-a',
    reconnected: false,
  });
  expect(handler).not.toHaveBeenCalled();
});

test('deregistration of agent disconnected handler should work', async () => {
  const handler = vi.fn();
  const deregister = event.registerAgentDisconnected(handler, { order: 10 });
  deregister();
  await event.emitAgentDisconnected({
    agentName: 'edge-a',
  });
  expect(handler).not.toHaveBeenCalled();
});

test('clearAllListenersForTests should clear self-update-starting handlers', async () => {
  const handler = vi.fn();
  event.registerSelfUpdateStarting(handler, { order: 10 });

  event.clearAllListenersForTests();

  await event.emitSelfUpdateStarting({
    opId: 'op-self-update',
    requiresAck: true,
    ackTimeoutMs: 1500,
  });
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

// ─── Per-handler timeout tests ────────────────────────────────────────────────

test('fast handler completes normally within timeout', async () => {
  event.setHandlerTimeoutMsForTests(50);
  const calls: string[] = [];
  event.registerContainerReport(
    async () => {
      calls.push('fast');
    },
    { id: 'fast.handler', order: 10 },
  );

  await event.emitContainerReport({});

  expect(calls).toEqual(['fast']);
  expect(warnMock).not.toHaveBeenCalled();
});

test('slow handler is skipped after timeout and next handler still runs', async () => {
  event.setHandlerTimeoutMsForTests(50);
  const calls: string[] = [];

  event.registerContainerReport(
    () =>
      new Promise<void>(() => {
        /* never resolves */
      }),
    { id: 'hung.handler', order: 10 },
  );
  event.registerContainerReport(
    async () => {
      calls.push('second');
    },
    { id: 'second.handler', order: 20 },
  );

  const start = Date.now();
  await event.emitContainerReport({});
  const elapsed = Date.now() - start;

  // Should have completed near the timeout window (50ms), not hung indefinitely.
  expect(elapsed).toBeLessThan(1000);
  expect(calls).toEqual(['second']);
}, 3000);

test('synchronous throw from handler propagates as rejection', async () => {
  event.setHandlerTimeoutMsForTests(50);
  event.registerContainerReport(
    () => {
      throw new Error('sync error');
    },
    { id: 'throwing.handler', order: 10 },
  );

  await expect(event.emitContainerReport({})).rejects.toThrow('sync error');
});

test('async rejection from handler propagates', async () => {
  event.setHandlerTimeoutMsForTests(50);
  event.registerContainerReport(
    async () => {
      throw new Error('async error');
    },
    { id: 'async-throwing.handler', order: 10 },
  );

  await expect(event.emitContainerReport({})).rejects.toThrow('async error');
});

test('timeout warning is logged with handler id and order', async () => {
  event.setHandlerTimeoutMsForTests(50);

  event.registerContainerReport(
    () =>
      new Promise<void>(() => {
        /* never resolves */
      }),
    { id: 'smtp.notification', order: 30 },
  );

  await event.emitContainerReport({});

  expect(warnMock).toHaveBeenCalledTimes(1);
  const warnMessage: string = warnMock.mock.calls[0][0];
  expect(warnMessage).toContain('timed out');
  expect(warnMessage).toContain('smtp.notification');
  expect(warnMessage).toContain('order=30');
}, 3000);

test('fast handler does not trigger a timeout warning', async () => {
  event.setHandlerTimeoutMsForTests(200);

  event.registerContainerReport(
    async () => {
      // Resolves well within the 200ms timeout.
    },
    { id: 'quick.handler', order: 10 },
  );

  await event.emitContainerReport({});

  // Give enough time for any stray timer to fire before asserting.
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  expect(warnMock).not.toHaveBeenCalled();
});

test('multiple slow handlers do not compound indefinitely; third fast handler still runs', async () => {
  event.setHandlerTimeoutMsForTests(50);
  const calls: string[] = [];

  event.registerContainerReport(
    () =>
      new Promise<void>(() => {
        /* never resolves */
      }),
    { id: 'slow.one', order: 10 },
  );
  event.registerContainerReport(
    () =>
      new Promise<void>(() => {
        /* never resolves */
      }),
    { id: 'slow.two', order: 20 },
  );
  event.registerContainerReport(
    async () => {
      calls.push('fast');
    },
    { id: 'fast.three', order: 30 },
  );

  const start = Date.now();
  await event.emitContainerReport({});
  const elapsed = Date.now() - start;

  // Two timeouts at 50ms each = ~100ms total. Should not balloon beyond a generous bound.
  expect(elapsed).toBeLessThan(2000);
  expect(calls).toEqual(['fast']);
  expect(warnMock).toHaveBeenCalledTimes(2);
}, 5000);

test('setHandlerTimeoutMsForTests and getHandlerTimeoutMsForTests round-trip', () => {
  event.setHandlerTimeoutMsForTests(1234);
  expect(event.getHandlerTimeoutMsForTests()).toBe(1234);

  event.setHandlerTimeoutMsForTests(undefined);
  expect(event.getHandlerTimeoutMsForTests()).toBe(30_000);
});

test('parseHandlerTimeoutMs falls back to default for missing/empty/invalid input', () => {
  expect(event.parseHandlerTimeoutMs(undefined)).toBe(30_000);
  expect(event.parseHandlerTimeoutMs('')).toBe(30_000);
  expect(event.parseHandlerTimeoutMs('   ')).toBe(30_000);
  expect(event.parseHandlerTimeoutMs('not-a-number')).toBe(30_000);
  expect(event.parseHandlerTimeoutMs('0')).toBe(30_000);
  expect(event.parseHandlerTimeoutMs('-100')).toBe(30_000);
  expect(event.parseHandlerTimeoutMs('Infinity')).toBe(30_000);
});

test('parseHandlerTimeoutMs accepts valid positive numbers', () => {
  expect(event.parseHandlerTimeoutMs('500')).toBe(500);
  expect(event.parseHandlerTimeoutMs('60000')).toBe(60_000);
  expect(event.parseHandlerTimeoutMs('1.5')).toBe(1.5);
});

test('timeout warning identifies anonymous handlers without an id', async () => {
  event.setHandlerTimeoutMsForTests(50);
  event.registerContainerReport(
    () =>
      new Promise<void>(() => {
        /* never resolves */
      }),
    { order: 10 }, // no id
  );

  await event.emitContainerReport({});

  expect(warnMock).toHaveBeenCalledTimes(1);
  expect(warnMock.mock.calls[0][0]).toContain('id=<anonymous>');
});

test('late rejection from a timed-out handler does not surface as unhandled', async () => {
  event.setHandlerTimeoutMsForTests(50);
  // Handler that rejects AFTER the timeout window. Without the .catch detach
  // in runHandlerWithTimeout, this would surface as an unhandled rejection.
  event.registerContainerReport(
    () =>
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => reject(new Error('late-failure')), 150);
      }),
    { id: 'late.reject', order: 10 },
  );

  await event.emitContainerReport({});

  // Wait past the late rejection so the registered .catch handler runs.
  await new Promise((resolve) => setTimeout(resolve, 250));

  expect(warnMock).toHaveBeenCalledTimes(1);
});
