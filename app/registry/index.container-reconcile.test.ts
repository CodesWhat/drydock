/**
 * DR-115: pruneOrphanedAgentContainers used to delete an orphaned record with a plain
 * deleteContainer(id), which stashes nothing. The physical container an agent-removal or
 * agent-rename prunes is often about to reappear under a different agent (or back on the
 * controller's own watcher) with the same Docker id, and a plain delete lost its update
 * policy (snooze, maturity mode/min-age, skipped tags) on that hand-off.
 *
 * This file deliberately does NOT mock ../store/container.js (unlike index.test.ts, which
 * mocks it wholesale and therefore cannot see this class of bug at all). It drives the real
 * store module against a real in-memory Loki collection so the stash/restore contract in
 * app/store/container.ts is actually exercised end to end.
 */

import Loki from 'lokijs';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockIsUpgrade = vi.hoisted(() => vi.fn(() => true));
vi.mock('../store/app.js', () => ({
  isUpgrade: mockIsUpgrade,
}));

vi.mock('../configuration/index.js', () => ({
  getLogLevel: vi.fn(() => 'info'),
  getLogFormat: vi.fn(() => 'json'),
  getLogBufferEnabled: vi.fn(() => true),
  getLocalWatcherEnabled: vi.fn(() => true),
  getRegistryConfigurations: vi.fn(() => ({})),
  getTriggerConfigurations: vi.fn(() => ({})),
  getWatcherConfigurations: vi.fn(() => ({})),
  getAuthenticationConfigurations: vi.fn(() => ({})),
  getAgentConfigurations: vi.fn(() => ({})),
  ddEnvVars: {},
}));

vi.mock('../store/index.js', () => ({
  save: vi.fn(),
  getConfiguration: vi.fn(() => ({ path: '/validated/store', file: 'dd.json' })),
}));

vi.mock('../security/scheduler.js', () => ({
  shutdown: vi.fn(),
}));

vi.mock('../maturity/scheduler.js', () => ({
  shutdown: vi.fn(),
}));

import * as storeContainer from '../store/container.js';
import { createContainerFixture } from '../test/helpers.js';
import Component from './Component.js';
import * as registry from './index.js';

const MATURITY_POLICY = { maturityMode: 'mature', maturityMinAgeDays: 5 };

describe('pruneOrphanedAgentContainers identity hand-off (real store/container.js)', () => {
  beforeEach(() => {
    const db = new Loki('test.db', { autosave: false });
    storeContainer.createCollections(db);
    storeContainer._resetContainerStoreStateForTests();
    for (const agentId of Object.keys(registry.getState().agent)) {
      delete registry.getState().agent[agentId];
    }
  });

  test('carries the update policy from an orphaned agent record to the agent that takes the container over', async () => {
    storeContainer.insertContainer(
      createContainerFixture({
        id: 'moved-away-id',
        name: 'nginx',
        watcher: 'docker.remote',
        agent: 'removed-agent',
        updatePolicy: MATURITY_POLICY,
      }),
    );
    // 'removed-agent' is not registered, so the record above is orphaned; 'kept-agent' is,
    // so its own record must survive untouched.
    const keptAgentComponent = new Component();
    await keptAgentComponent.register('agent', 'dd', 'kept-agent', {});
    registry.getState().agent[keptAgentComponent.getId()] = keptAgentComponent;

    registry.testable_pruneOrphanedAgentContainers();

    expect(storeContainer.getContainer('moved-away-id')).toBeUndefined();

    // The container reappears under the same Docker id but a different identity: a new
    // agent name, a renamed watcher. Only the id can carry the policy across that move.
    const reingested = storeContainer.insertContainer(
      createContainerFixture({
        id: 'moved-away-id',
        name: 'nginx',
        watcher: 'docker.local',
        agent: 'kept-agent',
      }),
    );

    expect(reingested.updatePolicy).toEqual(MATURITY_POLICY);
  });
});
