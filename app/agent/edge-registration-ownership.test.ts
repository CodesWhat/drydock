import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import * as registry from '../registry/index.js';
import * as store from '../store/index.js';
import { AgentClient } from './AgentClient.js';
import AgentTrigger from './components/AgentTrigger.js';
import AgentWatcher from './components/AgentWatcher.js';
import { EdgeAgentAdapter } from './EdgeAgentAdapter.js';
import { getAgent, removeAgent } from './manager.js';
import { PortwingDockerBridge } from './PortwingDockerBridge.js';

const initializeTrigger = AgentTrigger.prototype.init;

class TestSocket extends EventEmitter {
  holdRequests = false;
  readonly requestReceived = Promise.withResolvers<string>();

  send = vi.fn((raw: string) => {
    const frame = JSON.parse(raw);
    if (frame.type !== 'request') return;
    expect(frame.data.method).toBe('GET');
    expect(['/version', '/containers/json?all=true']).toContain(frame.data.path);
    if (frame.data.path === '/containers/json?all=true') {
      this.requestReceived.resolve(frame.data.path);
      if (this.holdRequests) return;
    }
    queueMicrotask(() =>
      this.emit(
        'message',
        JSON.stringify({
          type: 'response',
          data: {
            requestId: frame.data.requestId,
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: frame.data.path === '/version' ? { Version: '29.0.0' } : [],
          },
        }),
      ),
    );
  });

  close() {
    this.emit('close');
  }
}

const descriptor = {
  type: 'docker',
  name: 'docker',
  configuration: { transport: 'docker-api', execution: 'controller', events: 'portwing' },
};
const syncFrame = JSON.stringify({
  type: 'dd:component_sync',
  data: { watchers: [descriptor], triggers: [] },
});

function orderedFrames(adapter: EdgeAgentAdapter) {
  return (adapter as unknown as { orderedStateFrameChain: Promise<void> }).orderedStateFrameChain;
}

function watcherResources(watcher: AgentWatcher) {
  return watcher as unknown as {
    controllerBridge?: PortwingDockerBridge;
    controllerWatcher?: { watchCron?: unknown };
  };
}

describe('edge registration ownership with real component lifecycles', () => {
  const adapters: EdgeAgentAdapter[] = [];
  const watchers: AgentWatcher[] = [];
  const triggers: AgentTrigger[] = [];

  function connect() {
    const client = new AgentClient('ownership-agent', { host: '127.0.0.1', port: 1, secret: '' });
    const ws = new TestSocket();
    const adapter = new EdgeAgentAdapter(client, ws);
    client.edgeAdapter = adapter;
    adapter.activate();
    adapters.push(adapter);
    return { client, ws, adapter };
  }

  beforeEach(async () => {
    await store.init({ memory: true });
    const init = AgentWatcher.prototype.init;
    vi.spyOn(AgentWatcher.prototype, 'init').mockImplementation(async function () {
      watchers.push(this);
      await init.call(this);
    });
    vi.spyOn(AgentTrigger.prototype, 'init').mockImplementation(async function () {
      triggers.push(this);
      await initializeTrigger.call(this);
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const adapter of adapters.splice(0)) await adapter.onDisconnect();
    await registry.deregisterAgentComponents('ownership-agent');
    for (const watcher of watchers.splice(0)) await watcher.deregister();
    for (const trigger of triggers.splice(0)) await trigger.deregister();
    removeAgent('ownership-agent');
  });

  test('disconnect during the real inventory seed cannot publish the retired watcher', async () => {
    const old = connect();
    old.ws.holdRequests = true;
    old.ws.emit('message', syncFrame);
    const oldSync = orderedFrames(old.adapter);
    expect(await old.ws.requestReceived.promise).toBe('/containers/json?all=true');
    expect(watcherResources(watchers[0]).controllerBridge).toBeDefined();

    await old.adapter.onDisconnect();
    old.ws.close();
    const replacement = connect();
    replacement.ws.emit('message', syncFrame);
    await Promise.all([oldSync, orderedFrames(replacement.adapter)]);

    expect(getAgent(old.client.name)).toBe(replacement.client);
    expect(old.client.getWatcherSnapshot('docker', 'docker')).toBeUndefined();
    expect(watchers).toHaveLength(2);
    expect(Object.values(registry.getState().watcher)).toHaveLength(1);
    expect(Object.values(registry.getState().watcher)[0] === watchers[1]).toBe(true);
    expect(Object.values(registry.getState().trigger)).toHaveLength(1);
    expect(triggers).toHaveLength(1);
    expect(watcherResources(watchers[0]).controllerBridge).toBeUndefined();
    expect(watcherResources(watchers[0]).controllerWatcher).toBeUndefined();
    expect(watcherResources(watchers[1]).controllerBridge).toBeDefined();
    expect(watcherResources(watchers[1]).controllerWatcher?.watchCron).toBeDefined();
    await replacement.adapter.onDisconnect();
    expect(watchers.every((watcher) => !watcherResources(watcher).controllerBridge)).toBe(true);
    expect(Object.keys(registry.getState().watcher)).toHaveLength(0);
    expect(Object.keys(registry.getState().trigger)).toHaveLength(0);
  });

  test.each([false, true])(
    'a disconnected initializer cannot replace the new owner (cleanup throws: %s)',
    async (cleanupThrows) => {
      const old = connect();
      const ready = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const start = PortwingDockerBridge.prototype.start;
      let first = true;
      vi.spyOn(PortwingDockerBridge.prototype, 'start').mockImplementation(async function () {
        const endpoint = await start.call(this);
        if (first) {
          first = false;
          expect((this as unknown as { server: Server }).server.listening).toBe(true);
          ready.resolve();
          await resume.promise;
        }
        return endpoint;
      });
      old.ws.emit('message', syncFrame);
      const oldSync = orderedFrames(old.adapter);
      await ready.promise;
      try {
        if (cleanupThrows) {
          const retired = watchers[0];
          const deregister = retired.deregister;
          vi.spyOn(retired, 'deregister').mockImplementationOnce(async () => {
            await deregister.call(retired);
            throw new Error('abandoned cleanup failed');
          });
        }
        await old.adapter.onDisconnect();
        old.ws.close();
        const replacement = connect();
        replacement.ws.emit('message', syncFrame);
        await orderedFrames(replacement.adapter);
        const liveWatcher = Object.values(registry.getState().watcher)[0];
        const liveTrigger = Object.values(registry.getState().trigger)[0];
        resume.resolve();
        await oldSync;

        expect(getAgent(old.client.name)).toBe(replacement.client);
        expect(old.client.getWatcherSnapshot('docker', 'docker')).toBeUndefined();
        expect(Object.values(registry.getState().watcher)).toHaveLength(1);
        expect(Object.values(registry.getState().watcher)[0] === liveWatcher).toBe(true);
        expect(Object.values(registry.getState().trigger)).toHaveLength(1);
        expect(Object.values(registry.getState().trigger)[0] === liveTrigger).toBe(true);
        expect(watcherResources(watchers[0]).controllerBridge).toBeUndefined();
        expect(watcherResources(watchers[0]).controllerWatcher).toBeUndefined();
        expect(watcherResources(watchers[1]).controllerBridge).toBeDefined();
        expect(watcherResources(watchers[1]).controllerWatcher?.watchCron).toBeDefined();
        await replacement.adapter.onDisconnect();
        expect(watchers.every((watcher) => !watcherResources(watcher).controllerBridge)).toBe(true);
      } finally {
        resume.resolve();
        await oldSync;
      }
    },
  );

  test('wire-ordered repeated syncs replace and clean up the previous live watcher', async () => {
    const current = connect();
    current.ws.emit('message', syncFrame);
    current.ws.emit('message', syncFrame);
    await orderedFrames(current.adapter);
    expect(watchers).toHaveLength(2);
    expect(watcherResources(watchers[0]).controllerBridge).toBeUndefined();
    expect(Object.values(registry.getState().watcher)[0] === watchers[1]).toBe(true);
    expect(current.client.getWatcherSnapshot('docker', 'docker')).toBeDefined();
    await current.adapter.onDisconnect();
    expect(watchers.every((watcher) => !watcherResources(watcher).controllerBridge)).toBe(true);
    expect(Object.keys(registry.getState().watcher)).toHaveLength(0);
    expect(Object.keys(registry.getState().trigger)).toHaveLength(0);
  });

  test.each(['synthetic', 'remote'])(
    'a retired %s trigger initializer cannot publish over the replacement',
    async (kind) => {
      const old = connect();
      const ready = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      vi.mocked(AgentTrigger.prototype.init).mockImplementationOnce(async function () {
        triggers.push(this);
        await initializeTrigger.call(this);
        ready.resolve();
        await resume.promise;
      });
      const frame =
        kind === 'synthetic'
          ? syncFrame
          : JSON.stringify({
              type: 'dd:component_sync',
              data: {
                watchers: [],
                triggers: [
                  { type: 'mock', name: 'notice', configuration: {} },
                  { type: 'mock', name: 'second', configuration: {} },
                ],
              },
            });
      old.ws.emit('message', frame);
      const oldSync = orderedFrames(old.adapter);
      await ready.promise;
      try {
        await old.adapter.onDisconnect();
        const replacement = connect();
        replacement.ws.emit('message', frame);
        await orderedFrames(replacement.adapter);
        const live = Object.values(registry.getState().trigger);
        const count = triggers.length;
        const disposeOld = vi.spyOn(triggers[0], 'deregister');
        resume.resolve();
        await oldSync;
        expect(
          Object.values(registry.getState().trigger).every((item, index) => item === live[index]),
        ).toBe(true);
        expect(triggers).toHaveLength(count);
        expect(disposeOld).toHaveBeenCalledTimes(1);
        if (kind === 'synthetic')
          expect(old.client.getWatcherSnapshot('docker', 'docker')).toBeUndefined();
        await replacement.adapter.onDisconnect();
        expect(Object.keys(registry.getState().trigger)).toHaveLength(0);
        expect(watchers.every((watcher) => !watcherResources(watcher).controllerBridge)).toBe(true);
      } finally {
        resume.resolve();
        await oldSync;
      }
    },
  );
});
