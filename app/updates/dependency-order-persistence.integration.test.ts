import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { computeDependencyGraph } from '../dependencies/dependency-graph.js';
import * as event from '../event/index.js';
import type { Container } from '../model/container.js';
import * as containerStore from '../store/container.js';
import type { Database } from '../store/db/driver.js';
import * as updateOperationStore from '../store/update-operation.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import {
  type AcceptedContainerUpdateRequest,
  runAcceptedContainerUpdates,
} from './request-update.js';

/**
 * Spec 7.5 slice 1: the dependency fields have to survive the SQLite store, or
 * every consumer that reads containers back out of it (the dependency graph
 * API, list-view edges, batch update waves) sees no edges at all. This drives
 * the real store and the real wave dispatcher: containers go in through
 * insertContainer, come back out through getContainers, and the batch built
 * from what came back has to update the dependency before its dependent.
 */

function createContainer(id: string, overrides: Partial<Container> = {}): Container {
  return {
    id,
    name: id,
    watcher: 'local',
    image: {
      id: `image-${id}`,
      registry: { name: 'hub', url: 'https://registry-1.docker.io/v2' },
      name: `library/${id}`,
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    result: { tag: '1.0.1' },
    updateAvailable: true,
    ...overrides,
  } as Container;
}

class RecordingAction {
  readonly type = 'recording';
  readonly log: string[] = [];

  async trigger(container: Container, runtimeContext?: unknown): Promise<void> {
    const operationId = (runtimeContext as { operationId: string }).operationId;
    this.log.push(`start:${container.name}`);
    await Promise.resolve();
    updateOperationStore.markOperationTerminal(operationId, {
      status: 'succeeded',
      phase: 'succeeded',
    });
    this.log.push(`end:${container.name}`);
  }
}

describe('dependency ordering after a store round trip (spec 7.5 slice 1)', () => {
  let db: Database;

  beforeEach(() => {
    event.clearAllListenersForTests();
    db = createMigratedMemoryDatabase();
    containerStore.createCollections(db);
    updateOperationStore.createCollections(db);
  });

  afterEach(() => {
    event.clearAllListenersForTests();
    db.close();
  });

  test('a batch built from stored containers updates the dependency before its dependent', async () => {
    containerStore.insertContainer(
      createContainer('api', {
        dependsOn: ['db'],
        dependsOnSource: 'label',
        dependsOnAction: 'update',
      }),
    );
    containerStore.insertContainer(createContainer('db'));

    const stored = containerStore.getContainers();
    const byName = new Map(stored.map((container) => [container.name, container]));

    expect(computeDependencyGraph(stored).waves).toEqual([['db'], ['api']]);

    const action = new RecordingAction();
    // Dependent first, so an unordered dispatch would start it first.
    const accepted: AcceptedContainerUpdateRequest[] = ['api', 'db'].map((name) => {
      const container = byName.get(name) as Container;
      const operationId = `op-${name}`;
      updateOperationStore.insertOperation({
        id: operationId,
        containerId: container.id,
        containerName: container.name,
        container,
        triggerName: 'recording.action',
        status: 'queued',
        phase: 'queued',
      });
      return { container, operationId, trigger: action };
    });

    await runAcceptedContainerUpdates(accepted, { concurrency: 2 });

    expect(action.log).toEqual(['start:db', 'end:db', 'start:api', 'end:api']);
  });
});
