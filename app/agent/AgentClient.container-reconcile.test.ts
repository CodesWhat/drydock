/**
 * #831-follow-up regression coverage: every AgentClient container-reconcile entry point
 * used to call processAuthoritativeContainers() (insert/update) BEFORE pruneOldContainers()
 * (delete + stash) for the same batch. stashUpdatePolicyForReplacement() only runs from
 * inside deleteContainer({replacementExpected: true}), and insertContainer() consumes that
 * stash as its first action — so when a same-identity container arrives under a fresh id,
 * the insert ran before the stash existed, silently dropping the user's updatePolicy
 * (maturity mode/min-age) on every agent-owned recreate.
 *
 * This file deliberately does NOT mock ../store/container.js (unlike AgentClient.test.ts,
 * which mocks it wholesale and therefore cannot see this class of bug at all). It drives the
 * real store module against a real in-memory Loki collection so the stash/restore contract
 * in app/store/container.ts is actually exercised.
 */

import axios from 'axios';
import Loki from 'lokijs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('axios');

const mockLogChild = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => mockLogChild },
}));

// Real store/index.ts eagerly Joi-validates DD_STORE_* config and opens a real LokiJS
// database at import time. AgentClient.ts only reaches it lazily (via
// security/configured-sbom-storage.ts, itself only invoked when a container carries SBOM
// documents, which none of these fixtures do) but the import graph still loads the module,
// so it must be stubbed the same way AgentClient.test.ts stubs it.
vi.mock('../store/index.js', () => ({
  getConfiguration: vi.fn(() => ({ path: '/validated/store', file: 'dd.json' })),
}));

// One factory covering both AgentClient.ts's own event imports and the container
// lifecycle events the real store/container.js module emits on insert/update/delete.
vi.mock('../event/index.js', () => ({
  emitAgentConnected: vi.fn().mockResolvedValue(undefined),
  emitAgentDisconnected: vi.fn().mockResolvedValue(undefined),
  emitAgentStatsChanged: vi.fn().mockResolvedValue(undefined),
  emitBatchUpdateCompleted: vi.fn().mockResolvedValue(undefined),
  emitContainerReport: vi.fn().mockResolvedValue(undefined),
  emitContainerReports: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
  emitSecurityScanCycleComplete: vi.fn().mockResolvedValue(undefined),
  emitUpdateOperationChanged: vi.fn().mockResolvedValue(undefined),
  emitContainerAdded: vi.fn(),
  emitContainerUpdated: vi.fn(),
  emitContainerRemoved: vi.fn(),
  emitContainerHealthTransition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../maturity/gate-watch.js', () => ({
  maybeEmitMaturityGateCleared: vi.fn().mockResolvedValue(false),
}));

const mockRegistryState = vi.hoisted(() => ({
  trigger: {},
  watcher: {} as Record<string, unknown>,
  registry: {} as Record<string, unknown>,
  authentication: {},
  agent: {},
}));
vi.mock('../registry/index.js', () => ({
  deregisterAgentComponents: vi.fn().mockResolvedValue(undefined),
  registerComponent: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn(() => mockRegistryState),
}));

import * as storeContainer from '../store/container.js';
import { createContainerFixture } from '../test/helpers.js';
import { AgentClient } from './AgentClient.js';

const AGENT_NAME = 'agent1';
const WATCHER_NAME = 'docker';
const CONTAINER_NAME = 'nginx';
const MATURITY_POLICY = { maturityMode: 'mature', maturityMinAgeDays: 5 };

function seedOldContainerWithPolicy() {
  storeContainer.insertContainer(
    createContainerFixture({
      id: 'old-id',
      name: CONTAINER_NAME,
      watcher: WATCHER_NAME,
      agent: AGENT_NAME,
      updatePolicy: MATURITY_POLICY,
    }),
  );
}

function buildIncomingContainer(overrides: Record<string, unknown> = {}) {
  return createContainerFixture({
    id: 'new-id',
    name: CONTAINER_NAME,
    watcher: WATCHER_NAME,
    ...overrides,
  });
}

describe('AgentClient container-reconcile ordering (real store/container.js)', () => {
  let client: AgentClient;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const watcherId of Object.keys(mockRegistryState.watcher)) {
      delete mockRegistryState.watcher[watcherId];
    }
    const db = new Loki('test.db', { autosave: false });
    storeContainer.createCollections(db);
    storeContainer._resetContainerStoreStateForTests();
    vi.useFakeTimers();
    client = new AgentClient(AGENT_NAME, { host: 'localhost', port: 3001, secret: '' });
  });

  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  describe('_doHandshake() via handshake()', () => {
    test('retains updatePolicy when a same-identity container arrives under a new id', async () => {
      seedOldContainerWithPolicy();
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: [buildIncomingContainer()] }) // /api/containers
        .mockResolvedValueOnce({ data: [] }) // /api/watchers
        .mockResolvedValueOnce({ data: [] }); // /api/triggers

      await client.handshake();

      expect(storeContainer.getContainer('old-id')).toBeUndefined();
      expect(storeContainer.getContainer('new-id')?.updatePolicy).toEqual(MATURITY_POLICY);
    });
  });

  describe('watch()', () => {
    test('retains updatePolicy when a same-identity container arrives under a new id', async () => {
      seedOldContainerWithPolicy();
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: [{ container: buildIncomingContainer(), changed: true }],
      });

      await client.watch(WATCHER_NAME, WATCHER_NAME);

      expect(storeContainer.getContainer('old-id')).toBeUndefined();
      expect(storeContainer.getContainer('new-id')?.updatePolicy).toEqual(MATURITY_POLICY);
    });

    test('does not prune when the agent reports zero containers', async () => {
      // Prime hasConnectedOnce via a clean (zero-container) handshake, matching how
      // _doHandshake's own equivalent guard is exercised.
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      await client.handshake();

      seedOldContainerWithPolicy();
      vi.mocked(axios.post).mockResolvedValueOnce({ data: [] });

      await client.watch(WATCHER_NAME, WATCHER_NAME);

      expect(storeContainer.getContainer('old-id')).toBeDefined();
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('Watch returned 0 containers'),
      );
    });
  });

  describe('handleContainerSync()', () => {
    test('retains updatePolicy when a same-identity container arrives under a new id', async () => {
      seedOldContainerWithPolicy();

      await client.handleContainerSync([buildIncomingContainer()]);

      expect(storeContainer.getContainer('old-id')).toBeUndefined();
      expect(storeContainer.getContainer('new-id')?.updatePolicy).toEqual(MATURITY_POLICY);
    });
  });

  describe('handleWatcherSnapshotEvent() via handleEvent', () => {
    test('retains updatePolicy when a same-identity container arrives under a new id', async () => {
      seedOldContainerWithPolicy();

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: WATCHER_NAME, name: WATCHER_NAME },
        containers: [buildIncomingContainer()],
      });

      expect(storeContainer.getContainer('old-id')).toBeUndefined();
      expect(storeContainer.getContainer('new-id')?.updatePolicy).toEqual(MATURITY_POLICY);
    });

    test('does not prune when the agent reports zero containers', async () => {
      // Prime hasConnectedOnce via a clean (zero-container) handshake, matching how
      // _doHandshake's own equivalent guard is exercised.
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      await client.handshake();

      seedOldContainerWithPolicy();

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: WATCHER_NAME, name: WATCHER_NAME },
        containers: [],
      });

      expect(storeContainer.getContainer('old-id')).toBeDefined();
      expect(storeContainer.getContainer('old-id')?.updatePolicy).toEqual(MATURITY_POLICY);
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('Watcher snapshot returned 0 containers'),
      );
    });
  });
});
