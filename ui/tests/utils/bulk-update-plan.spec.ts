import type { Container, DependencyGraph, DependencyGraphNode } from '@/types/container';
import {
  type BulkRowState,
  type BulkUpdatePlan,
  planBulkUpdate,
  withStaleParents,
} from '@/utils/bulk-update-plan';
import { buildDependencyAdjacency } from '@/utils/dependency-graph-view';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    identityKey: 'c1',
    name: 'nginx',
    image: 'nginx',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: '1.1.0',
    isDigestPinned: false,
    status: 'running',
    registry: 'dockerhub',
    updateKind: 'minor',
    bouncer: 'safe',
    server: 'Local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

function makeNode(id: string, name = id): DependencyGraphNode {
  return { id, name, displayName: name };
}

function makeAdjacency(overrides: Partial<DependencyGraph> = {}) {
  return buildDependencyAdjacency({
    nodes: overrides.nodes ?? [],
    edges: overrides.edges ?? [],
    cycles: overrides.cycles ?? [],
    unresolved: overrides.unresolved ?? [],
    crossHostIgnored: overrides.crossHostIgnored ?? [],
  });
}

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

function rowStateFrom(states: Record<string, BulkRowState>) {
  return (container: Container): BulkRowState => states[container.id] ?? 'none';
}

function noneLocked() {
  return () => false;
}

describe('planBulkUpdate', () => {
  it('dispatches a plain updatable container with no adjacency and no grouping', () => {
    const containers = [makeContainer({ id: 'c1' })];
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers,
      adjacency: null,
      rowState: rowStateFrom({ c1: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.dispatch).toEqual([{ id: 'c1', name: 'nginx' }]);
    expect(plan.skipped).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.agentCount).toBe(0);
    expect(plan.stackCount).toBe(0);
  });

  it('classifies an id no longer present in containers as skipped/stale, preserving selection order and using the id as the name', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['gone', 'c1']),
      containers: [makeContainer({ id: 'c1' })],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.skipped).toEqual([
      { id: 'gone', name: 'gone', reason: 'containerComponents.selection.reasons.stale' },
    ]);
    expect(plan.dispatch).toEqual([{ id: 'c1', name: 'nginx' }]);
  });

  it('classifies a locked row as skipped/inFlight before consulting rowState', () => {
    const container = makeContainer({ id: 'c1' });
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [container],
      adjacency: null,
      rowState: () => {
        throw new Error('rowState must not be called for a locked row');
      },
      isRowLocked: () => true,
      t,
    });
    expect(plan.skipped).toEqual([
      { id: 'c1', name: 'nginx', reason: 'containerComponents.selection.reasons.inFlight' },
    ]);
  });

  it('classifies rowState none as skipped/noUpdate', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [makeContainer({ id: 'c1' })],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'none' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.skipped).toEqual([
      { id: 'c1', name: 'nginx', reason: 'containerComponents.selection.reasons.noUpdate' },
    ]);
    expect(plan.dispatch).toEqual([]);
  });

  it('classifies rowState blocked as blocked with no reason', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [makeContainer({ id: 'c1', bouncer: 'blocked' })],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'blocked' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.blocked).toEqual([{ id: 'c1', name: 'nginx' }]);
    expect(plan.dispatch).toEqual([]);
  });

  it('classifies rowState hard as blocked with the primary hard blocker message', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [
        makeContainer({
          id: 'c1',
          updateEligibility: {
            eligible: false,
            evaluatedAt: '2026-01-01T00:00:00.000Z',
            blockers: [
              {
                reason: 'rollback-container',
                severity: 'hard',
                message: 'rolled back',
                actionable: false,
              },
            ],
          },
        }),
      ],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'hard' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.blocked).toEqual([{ id: 'c1', name: 'nginx', reason: 'rolled back' }]);
    expect(plan.dispatch).toEqual([]);
  });

  it('classifies rowState hard as blocked with no reason when there is no hard blocker on the payload', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [makeContainer({ id: 'c1' })],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'hard' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.blocked).toEqual([{ id: 'c1', name: 'nginx', reason: undefined }]);
  });

  it('dispatches rowState soft and also records it in softOverrides with the joined blocker text', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [
        makeContainer({
          id: 'c1',
          updateEligibility: {
            eligible: true,
            evaluatedAt: '2026-01-01T00:00:00.000Z',
            blockers: [
              {
                reason: 'snoozed',
                severity: 'soft',
                message: 'Snoozed until tomorrow',
                actionable: true,
              },
              { reason: 'skip-tag', severity: 'soft', message: 'Tag skipped', actionable: true },
            ],
          },
        }),
      ],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.dispatch).toEqual([{ id: 'c1', name: 'nginx' }]);
    expect(plan.softOverrides).toEqual([
      { id: 'c1', name: 'nginx', reason: 'Snoozed until tomorrow; Tag skipped' },
    ]);
  });

  it('does not populate softOverrides for a row that is not classified as soft', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [makeContainer({ id: 'c1' })],
      adjacency: null,
      rowState: () => 'none',
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.softOverrides).toEqual([]);
  });

  it('dispatches a rowState ready row without adding it to softOverrides', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [makeContainer({ id: 'c1' })],
      adjacency: null,
      rowState: () => 'ready',
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.dispatch).toEqual([{ id: 'c1', name: 'nginx' }]);
    expect(plan.softOverrides).toEqual([]);
  });

  it('preserves selection order across mixed classifications', () => {
    const containers = [
      makeContainer({ id: 'a' }),
      makeContainer({ id: 'b' }),
      makeContainer({ id: 'c' }),
    ];
    const plan = planBulkUpdate({
      selectedIds: new Set(['c', 'a', 'b']),
      containers,
      adjacency: null,
      rowState: rowStateFrom({ a: 'soft', b: 'soft', c: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.dispatch.map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
  });

  it('reports a stale parent that has a pending update and is not itself selected, deduped across multiple dispatch entries', () => {
    const adjacency = makeAdjacency({
      nodes: [makeNode('app1'), makeNode('app2'), makeNode('db', 'database')],
      edges: [
        { from: 'app1', to: 'db', action: 'update', source: 'label' },
        { from: 'app2', to: 'db', action: 'update', source: 'label' },
      ],
    });
    const containers = [
      makeContainer({ id: 'app1', name: 'app1' }),
      makeContainer({ id: 'app2', name: 'app2' }),
      makeContainer({ id: 'db', name: 'database', newTag: '2.0.0' }),
    ];
    const plan = planBulkUpdate({
      selectedIds: new Set(['app1', 'app2']),
      containers,
      adjacency,
      rowState: rowStateFrom({ app1: 'soft', app2: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.staleParents).toEqual([{ id: 'db', name: 'database' }]);
  });

  it('does not report a stale parent that is itself part of the dispatch set', () => {
    const adjacency = makeAdjacency({
      nodes: [makeNode('app'), makeNode('db')],
      edges: [{ from: 'app', to: 'db', action: 'update', source: 'label' }],
    });
    const containers = [
      makeContainer({ id: 'app' }),
      makeContainer({ id: 'db', name: 'db', newTag: '2.0.0' }),
    ];
    const plan = planBulkUpdate({
      selectedIds: new Set(['app', 'db']),
      containers,
      adjacency,
      rowState: rowStateFrom({ app: 'soft', db: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.staleParents).toEqual([]);
  });

  it('never warns about a parent that is not in the current container list', () => {
    const adjacency = makeAdjacency({
      nodes: [makeNode('app'), makeNode('db', 'database')],
      edges: [{ from: 'app', to: 'db', action: 'update', source: 'label' }],
    });
    const plan = planBulkUpdate({
      selectedIds: new Set(['app']),
      containers: [makeContainer({ id: 'app' })],
      adjacency,
      rowState: rowStateFrom({ app: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.staleParents).toEqual([]);
  });

  it('returns no staleParents when adjacency is null, even with a dispatch set', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [makeContainer({ id: 'c1' })],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.staleParents).toEqual([]);
  });

  it('computes agentCount from distinct agent names among dispatch entries only', () => {
    const containers = [
      makeContainer({ id: 'a', agent: 'edge-1' }),
      makeContainer({ id: 'b', agent: 'edge-2' }),
      makeContainer({ id: 'c', agent: 'edge-1' }),
      makeContainer({ id: 'skip', agent: 'edge-3' }),
    ];
    const plan = planBulkUpdate({
      selectedIds: new Set(['a', 'b', 'c', 'skip']),
      containers,
      adjacency: null,
      rowState: rowStateFrom({ a: 'soft', b: 'soft', c: 'soft', skip: 'none' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.agentCount).toBe(2);
  });

  it('does not count an undefined agent field toward agentCount', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [makeContainer({ id: 'c1', agent: undefined })],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.agentCount).toBe(0);
  });

  it('computes stackCount from distinct groupKeyForContainer results among dispatch entries only', () => {
    const containers = [
      makeContainer({ id: 'a', name: 'a' }),
      makeContainer({ id: 'b', name: 'b' }),
      makeContainer({ id: 'c', name: 'c' }),
      makeContainer({ id: 'skip', name: 'skip' }),
    ];
    const groupKeyForContainer = (container: Container) =>
      container.name === 'a' || container.name === 'b' ? 'stack-1' : 'stack-2';
    const plan = planBulkUpdate({
      selectedIds: new Set(['a', 'b', 'c', 'skip']),
      containers,
      adjacency: null,
      rowState: rowStateFrom({ a: 'soft', b: 'soft', c: 'soft', skip: 'none' }),
      isRowLocked: noneLocked(),
      groupKeyForContainer,
      t,
    });
    expect(plan.stackCount).toBe(2);
  });

  it('defaults stackCount to 0 when groupKeyForContainer is not provided', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [makeContainer({ id: 'c1' })],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'soft' }),
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan.stackCount).toBe(0);
  });

  it('does not count a null/undefined groupKeyForContainer result toward stackCount', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(['c1']),
      containers: [makeContainer({ id: 'c1' })],
      adjacency: null,
      rowState: rowStateFrom({ c1: 'soft' }),
      isRowLocked: noneLocked(),
      groupKeyForContainer: () => null,
      t,
    });
    expect(plan.stackCount).toBe(0);
  });

  it('returns an empty plan for an empty selection', () => {
    const plan = planBulkUpdate({
      selectedIds: new Set(),
      containers: [],
      adjacency: null,
      rowState: () => 'soft',
      isRowLocked: noneLocked(),
      t,
    });
    expect(plan).toEqual<BulkUpdatePlan>({
      dispatch: [],
      skipped: [],
      blocked: [],
      softOverrides: [],
      staleParents: [],
      agentCount: 0,
      stackCount: 0,
    });
  });
});

describe('withStaleParents', () => {
  it('folds staleParents into dispatch and clears staleParents', () => {
    const plan: BulkUpdatePlan = {
      dispatch: [{ id: 'app', name: 'app' }],
      skipped: [],
      blocked: [],
      softOverrides: [],
      staleParents: [{ id: 'db', name: 'database' }],
      agentCount: 0,
      stackCount: 0,
    };
    const result = withStaleParents(plan);
    expect(result.dispatch).toEqual([
      { id: 'app', name: 'app' },
      { id: 'db', name: 'database' },
    ]);
    expect(result.staleParents).toEqual([]);
  });

  it('does not duplicate a stale parent that is already in dispatch', () => {
    const plan: BulkUpdatePlan = {
      dispatch: [{ id: 'app', name: 'app' }],
      skipped: [],
      blocked: [],
      softOverrides: [],
      staleParents: [{ id: 'app', name: 'app' }],
      agentCount: 0,
      stackCount: 0,
    };
    const result = withStaleParents(plan);
    expect(result.dispatch).toEqual([{ id: 'app', name: 'app' }]);
  });

  it('leaves other fields untouched', () => {
    const plan: BulkUpdatePlan = {
      dispatch: [],
      skipped: [{ id: 's', name: 's', reason: 'x' }],
      blocked: [{ id: 'b', name: 'b' }],
      softOverrides: [{ id: 'o', name: 'o', reason: 'y' }],
      staleParents: [],
      agentCount: 3,
      stackCount: 2,
    };
    const result = withStaleParents(plan);
    expect(result.skipped).toEqual(plan.skipped);
    expect(result.blocked).toEqual(plan.blocked);
    expect(result.softOverrides).toEqual(plan.softOverrides);
    expect(result.agentCount).toBe(3);
    expect(result.stackCount).toBe(2);
  });
});
