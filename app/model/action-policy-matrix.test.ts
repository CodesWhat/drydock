import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * spec-6.0.1-action-policy.md — regression matrix (contract item 9), slice 6
 * release gate.
 *
 * Every one of the 16 cases listed under "Regression matrix" is asserted
 * end-to-end through `selectActionTrigger`/`resolveForTrigger` (the resolver
 * that backs display, manual admission, and auto-dispatch alike). Cases 1
 * and 4 additionally exercise the real admission path
 * (`enqueueContainerUpdate`/`requestContainerUpdate` from
 * `app/updates/request-update.ts`) because those two cases are the direct
 * proof of the DEPRECATIONS.md soft->hard flip landing in this slice: a
 * `trigger-not-included`/`trigger-excluded` verdict now rejects a manual
 * update, not just an automatic one. Cases 11 and 12 are inherently about
 * the `updateMode` ceiling, which the resolver deliberately does NOT apply
 * (spec: "stays a separate composition step at call sites") — those two are
 * asserted purely through the real admission path.
 */

const {
  mockGetActiveOperationByContainerId,
  mockInsertOperation,
  mockGetState,
  mockGetUpdateMode,
  mockStatSync,
} = vi.hoisted(() => ({
  mockGetActiveOperationByContainerId: vi.fn(),
  mockInsertOperation: vi.fn(),
  mockGetState: vi.fn(() => ({ trigger: {}, watcher: {} })),
  mockGetUpdateMode: vi.fn(() => 'auto' as const),
  mockStatSync: vi.fn(() => ({ isSocket: () => false })),
}));

vi.mock('../agent/manager.js', () => ({
  getAgent: vi.fn(),
}));

vi.mock('../store/settings.js', () => ({
  getUpdateMode: mockGetUpdateMode,
}));

vi.mock('../store/update-operation.js', () => ({
  getOperationById: vi.fn(),
  getActiveOperationByContainerId: mockGetActiveOperationByContainerId,
  getActiveOperationByContainerName: vi.fn(),
  getRecentTerminalSucceededOperationByContainerName: vi.fn(() => undefined),
  hasOtherActiveOperationByContainerName: vi.fn(() => false),
  insertOperation: mockInsertOperation,
  markOperationTerminal: vi.fn(),
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../log/index.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock('node:fs', () => ({
  default: { statSync: mockStatSync },
}));

vi.mock('../updates/dependency-restart.js', () => ({
  restartDependentContainer: vi.fn(),
}));

import { enqueueContainerUpdate, requestContainerUpdate } from '../updates/request-update.js';
import {
  type ActionPolicyTrigger,
  findInertAutoLabelContainers,
  resolveForTrigger,
  selectActionTrigger,
} from './action-policy.js';
import type { Container } from './container.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'web',
    watcher: 'local',
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '1.1.0', semverDiff: 'minor' },
    ...overrides,
  } as Container;
}

function makeTrigger(
  id: string,
  overrides: Partial<ActionPolicyTrigger> = {},
): ActionPolicyTrigger {
  return {
    type: 'docker',
    getId: () => id,
    configuration: {},
    ...overrides,
  } as ActionPolicyTrigger;
}

/** A container shaped for the real admission path (has a raw tag update). */
function makeAdmissionContainer(overrides: Record<string, unknown> = {}): Container {
  return {
    ...makeContainer(),
    image: { name: 'nginx', tag: { value: '1.0.0' } },
    result: { tag: '1.1.0' },
    updateAvailable: true,
    ...overrides,
  } as unknown as Container;
}

/** A trigger shaped for the real admission path (has a spy-able `.trigger`). */
function makeAdmissionTrigger(id: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'docker',
    trigger: vi.fn().mockResolvedValue(undefined),
    agent: undefined,
    configuration: { threshold: 'all' },
    getId: () => id,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveOperationByContainerId.mockReturnValue(undefined);
  mockGetState.mockReturnValue({ trigger: {}, watcher: {} });
  mockGetUpdateMode.mockReturnValue('auto');
  mockStatSync.mockReturnValue({ isSocket: () => false });
  mockInsertOperation.mockImplementation((operation) => ({
    id: operation.id || 'op-1',
    ...operation,
  }));
});

// ---------------------------------------------------------------------------
// Case 1 — oninclude default, no labels -> blocked, no auto fire
//          (hard post-slice-6: this is the flagship soft->hard flip proof)
// ---------------------------------------------------------------------------

describe('case 1: oninclude default, no labels -> blocked, no auto fire (hard post-slice-6)', () => {
  test('resolver: not-included, never selected by the walk (display or auto-dispatch)', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });
    const container = makeContainer();

    expect(resolveForTrigger(trigger, container)).toStrictEqual({
      state: 'blocked',
      reason: 'not-included',
    });
    expect(selectActionTrigger({ 'docker.update': trigger }, container)).toBeUndefined();
    expect(
      selectActionTrigger({ 'docker.update': trigger }, container, { requireAuto: true }),
    ).toBeUndefined();
  });

  test('admission: manual update is now hard-rejected with 409 trigger-not-included', async () => {
    const trigger = makeAdmissionTrigger('docker.update', {
      configuration: { auto: 'oninclude', threshold: 'all' },
    });
    mockGetState.mockReturnValue({ trigger: { 'docker.update': trigger }, watcher: {} });
    const container = makeAdmissionContainer();

    await expect(requestContainerUpdate(container)).rejects.toMatchObject({
      statusCode: 409,
      message: "Trigger not matched by container label dd.action.include='undefined'.",
    });
    expect(trigger.trigger).not.toHaveBeenCalled();
    expect(mockInsertOperation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 2 — include only -> manual under onauto, auto under frozen oninclude
// ---------------------------------------------------------------------------

test('case 2: include only resolves manual under onauto, auto under frozen oninclude', () => {
  const container = makeContainer({ actionTriggerInclude: 'docker.update' });
  const onauto = makeTrigger('docker.update', { configuration: { auto: 'onauto' } });
  const oninclude = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });

  expect(resolveForTrigger(onauto, container)).toStrictEqual({ state: 'manual' });
  expect(
    selectActionTrigger({ 'docker.update': onauto }, container, { requireAuto: true }),
  ).toBeUndefined();

  expect(resolveForTrigger(oninclude, container)).toStrictEqual({ state: 'auto' });
  expect(
    selectActionTrigger({ 'docker.update': oninclude }, container, { requireAuto: true })
      ?.triggerId,
  ).toBe('docker.update');
});

// ---------------------------------------------------------------------------
// Case 3 — auto label only, onauto -> auto + manual access (decision 2)
// ---------------------------------------------------------------------------

test('case 3: dd.action.auto alone grants manual+auto access under onauto (decision 2)', () => {
  const trigger = makeTrigger('docker.update', { configuration: { auto: 'onauto' } });
  const container = makeContainer({ actionTriggerAuto: 'docker.update' });

  expect(resolveForTrigger(trigger, container)).toStrictEqual({ state: 'auto' });
  expect(selectActionTrigger({ 'docker.update': trigger }, container)?.state).toBe('auto');
  expect(
    selectActionTrigger({ 'docker.update': trigger }, container, { requireAuto: true })?.triggerId,
  ).toBe('docker.update');
});

// ---------------------------------------------------------------------------
// Case 4 — exclude beats include+auto -> blocked, trigger-excluded
//          (also a hard-flip proof: manual admission is now rejected)
// ---------------------------------------------------------------------------

describe('case 4: exclude beats include+auto -> blocked, trigger-excluded', () => {
  test('resolver: excluded wins over a matching include and a matching auto label', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'onauto' } });
    const container = makeContainer({
      actionTriggerInclude: 'docker.update',
      actionTriggerAuto: 'docker.update',
      actionTriggerExclude: 'docker.update',
    });

    expect(resolveForTrigger(trigger, container)).toStrictEqual({
      state: 'blocked',
      reason: 'excluded',
    });
    expect(
      selectActionTrigger({ 'docker.update': trigger }, container, { requireAuto: true }),
    ).toStrictEqual({
      state: 'blocked',
      reason: 'excluded',
      trigger,
      triggerId: 'docker.update',
    });
  });

  test('admission: manual update is now hard-rejected with 409 trigger-excluded', async () => {
    const trigger = makeAdmissionTrigger('docker.update', {
      configuration: { auto: 'onauto', threshold: 'all' },
    });
    mockGetState.mockReturnValue({ trigger: { 'docker.update': trigger }, watcher: {} });
    const container = makeAdmissionContainer({
      actionTriggerInclude: 'docker.update',
      actionTriggerAuto: 'docker.update',
      actionTriggerExclude: 'docker.update',
    });

    await expect(requestContainerUpdate(container)).rejects.toMatchObject({
      statusCode: 409,
      message: "Trigger excluded by container label dd.action.exclude='docker.update'.",
    });
    expect(trigger.trigger).not.toHaveBeenCalled();
    expect(mockInsertOperation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 5 — two compatible triggers, one authorized -> authorized wins
// everywhere (display walk and auto-dispatch walk both agree)
// ---------------------------------------------------------------------------

test('case 5: two compatible triggers, one authorized -> the authorized one wins everywhere', () => {
  const container = makeContainer({ actionTriggerInclude: 'case5-b' });
  const triggers = {
    a: makeTrigger('case5-a', { configuration: { auto: 'oninclude' } }), // not included
    b: makeTrigger('case5-b', { configuration: { auto: 'oninclude' } }), // included
  };

  expect(selectActionTrigger(triggers, container)?.triggerId).toBe('case5-b');
  expect(selectActionTrigger(triggers, container, { requireAuto: true })?.triggerId).toBe(
    'case5-b',
  );
});

// ---------------------------------------------------------------------------
// Case 6 — two auto-authorized triggers -> only the ranked winner fires
// (double-dispatch closure: each trigger's own dispatch gate is simulated
// and only the ranked winner's gate ever opens)
// ---------------------------------------------------------------------------

test('case 6: two auto-authorized triggers -> only the ranked winner fires (double-dispatch closure)', () => {
  const container = makeContainer();
  const triggers = {
    first: makeTrigger('case6-first', { configuration: { auto: 'all' } }),
    second: makeTrigger('case6-second', { configuration: { auto: 'all' } }),
  };

  // Mirrors Trigger.ts's real per-instance dispatch gate: each trigger asks
  // the walk for the winner and only fires when the winner is itself.
  const fired: string[] = [];
  for (const candidate of Object.values(triggers)) {
    const winner = selectActionTrigger(triggers, container, { requireAuto: true });
    if (winner?.triggerId === candidate.getId()) {
      fired.push(candidate.getId());
    }
  }

  expect(fired).toStrictEqual(['case6-first']);
});

// ---------------------------------------------------------------------------
// Case 7 — exclude on specific trigger + permissive catch-all -> hard stop
// (decision 3)
// ---------------------------------------------------------------------------

test('case 7: exclude on a specific trigger hard-stops past a permissive catch-all (decision 3)', () => {
  const container = makeContainer({ actionTriggerExclude: 'case7-specific' });
  const triggers = {
    specific: makeTrigger('case7-specific', { configuration: { auto: 'all' } }),
    catchAll: makeTrigger('case7-catch-all', { configuration: { auto: 'all' } }),
  };

  expect(selectActionTrigger(triggers, container)).toMatchObject({
    state: 'blocked',
    reason: 'excluded',
    triggerId: 'case7-specific',
  });
  expect(selectActionTrigger(triggers, container, { requireAuto: true })).toMatchObject({
    state: 'blocked',
    reason: 'excluded',
    triggerId: 'case7-specific',
  });
});

// ---------------------------------------------------------------------------
// Case 8 — not-included on specific + authorized catch-all -> catch-all
// serves
// ---------------------------------------------------------------------------

test('case 8: not-included on a specific trigger falls through to an authorized catch-all', () => {
  const container = makeContainer({ actionTriggerInclude: 'case8-catch-all' });
  const triggers = {
    specific: makeTrigger('case8-specific', { configuration: { auto: 'oninclude' } }),
    catchAll: makeTrigger('case8-catch-all', { configuration: { auto: 'oninclude' } }),
  };

  const result = selectActionTrigger(triggers, container);
  expect(result?.triggerId).toBe('case8-catch-all');
  expect(result?.state).toBe('auto');
});

// ---------------------------------------------------------------------------
// Case 9 — compose-file affinity picks the file-matched trigger regardless
// of insertion order; ambiguous-suffix stays conservative
// ---------------------------------------------------------------------------

test('case 9: file-matched dockercompose wins over registration order', () => {
  const container = makeContainer({
    labels: {
      'com.docker.compose.project.config_files': '/opt/drydock/test/monitoring/compose.yaml',
    },
  });
  const catchAll = makeTrigger('dockercompose.catch-all', {
    type: 'dockercompose',
    configuration: { auto: 'all' },
  });
  const fileMatched = makeTrigger('dockercompose.monitoring', {
    type: 'dockercompose',
    configuration: { auto: 'all' },
    getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring/compose.yaml',
    getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring/compose.yaml'],
  });
  // Registered "wrong way round": catch-all first, file-matched second.
  const triggers = {
    'dockercompose.catch-all': catchAll,
    'dockercompose.monitoring': fileMatched,
  };

  expect(selectActionTrigger(triggers, container)?.triggerId).toBe('dockercompose.monitoring');
});

test('case 9b: ambiguous compose-suffix match still stays conservative (not selected)', () => {
  const container = makeContainer({
    labels: {
      'com.docker.compose.project.config_files': '/mnt/volume1/docker/stacks/compose.yaml',
    },
  });
  const ambiguous = makeTrigger('dockercompose.ambiguous', {
    type: 'dockercompose',
    configuration: { auto: 'all' },
    getDefaultComposeFilePath: () => '/opt/drydock/stacks/compose.yaml',
    getComposeFilesForContainer: () => ['/mnt/volume1/docker/stacks/compose.yaml'],
  });

  expect(selectActionTrigger({ 'dockercompose.ambiguous': ambiguous }, container)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Case 10 — same-name containers on different agents resolve independently
// ---------------------------------------------------------------------------

test('case 10: same-name containers on different agents resolve independently', () => {
  const triggers = {
    a: makeTrigger('docker.a', { agent: 'agent-a', configuration: { auto: 'oninclude' } }),
    b: makeTrigger('docker.b', { agent: 'agent-b', configuration: { auto: 'oninclude' } }),
  };
  const containerA = makeContainer({
    name: 'web',
    agent: 'agent-a',
    actionTriggerInclude: 'docker.a',
  });
  const containerB = makeContainer({
    name: 'web',
    agent: 'agent-b',
    actionTriggerInclude: 'docker.b',
  });

  expect(selectActionTrigger(triggers, containerA)?.triggerId).toBe('docker.a');
  expect(selectActionTrigger(triggers, containerB)?.triggerId).toBe('docker.b');
});

// ---------------------------------------------------------------------------
// Case 11 — updateMode=manual clamps resolved auto -> no dispatch, manual
// admission still ok
// ---------------------------------------------------------------------------

test('case 11: updateMode=manual clamps resolved auto -> automatic admission rejected, manual admission still admits', async () => {
  mockGetUpdateMode.mockReturnValue('manual');
  const trigger = makeAdmissionTrigger('docker.update', {
    configuration: { auto: 'all', threshold: 'all' },
  });
  mockGetState.mockReturnValue({ trigger: { 'docker.update': trigger }, watcher: {} });
  const container = makeAdmissionContainer();

  // The resolver itself still resolves 'auto' — the ceiling is a call-site concern.
  expect(resolveForTrigger(trigger as unknown as ActionPolicyTrigger, container)).toStrictEqual({
    state: 'auto',
  });

  await expect(enqueueContainerUpdate(container, { source: 'automatic' })).rejects.toMatchObject({
    statusCode: 409,
    message: 'Update mode is manual; automatic updates are disabled',
  });
  expect(trigger.trigger).not.toHaveBeenCalled();

  const accepted = await requestContainerUpdate(container);
  expect(accepted.operationId).toBeDefined();
  expect(trigger.trigger).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Case 12 — updateMode=notify rejects all admission regardless of resolved
// state
// ---------------------------------------------------------------------------

test('case 12: updateMode=notify rejects all admission regardless of resolved action-policy state', async () => {
  mockGetUpdateMode.mockReturnValue('notify');
  const trigger = makeAdmissionTrigger('docker.update', {
    configuration: { auto: 'all', threshold: 'all' },
  });
  mockGetState.mockReturnValue({ trigger: { 'docker.update': trigger }, watcher: {} });
  const container = makeAdmissionContainer();

  await expect(enqueueContainerUpdate(container, { source: 'automatic' })).rejects.toMatchObject({
    statusCode: 409,
    message: 'Update mode is notify; Drydock will not apply updates',
  });
  await expect(requestContainerUpdate(container)).rejects.toMatchObject({
    statusCode: 409,
    message: 'Update mode is notify; Drydock will not apply updates',
  });
  expect(trigger.trigger).not.toHaveBeenCalled();
  expect(mockInsertOperation).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Case 13 — AUTO=none + auto label -> manual cap + WARN, never fires
// ---------------------------------------------------------------------------

test('case 13: AUTO=none caps at manual even with a matching dd.action.auto label (fail closed) + WARN precondition', () => {
  const trigger = makeTrigger('docker.update', { configuration: { auto: 'none' } });
  const container = makeContainer({ actionTriggerAuto: 'docker.update' });

  expect(resolveForTrigger(trigger, container)).toStrictEqual({ state: 'manual' });
  expect(
    selectActionTrigger({ 'docker.update': trigger }, container, { requireAuto: true }),
  ).toBeUndefined();
  // findInertAutoLabelContainers is the pure precondition the startup WARN (slice 5) is
  // built on: it names this exact misconfiguration (AUTO=none + matching dd.action.auto).
  expect(findInertAutoLabelContainers(trigger, [container])).toStrictEqual([container]);
});

// ---------------------------------------------------------------------------
// Case 14 — legacy bools true/false === all/none
// ---------------------------------------------------------------------------

test('case 14: legacy auto:true/false booleans behave exactly like all/none', () => {
  const open = makeContainer();
  expect(
    resolveForTrigger(makeTrigger('docker.update', { configuration: { auto: true } }), open),
  ).toStrictEqual(
    resolveForTrigger(makeTrigger('docker.update', { configuration: { auto: 'all' } }), open),
  );
  expect(
    resolveForTrigger(makeTrigger('docker.update', { configuration: { auto: false } }), open),
  ).toStrictEqual(
    resolveForTrigger(makeTrigger('docker.update', { configuration: { auto: 'none' } }), open),
  );

  const excluded = makeContainer({ actionTriggerExclude: 'docker.update' });
  expect(
    resolveForTrigger(makeTrigger('docker.update', { configuration: { auto: true } }), excluded),
  ).toStrictEqual(
    resolveForTrigger(makeTrigger('docker.update', { configuration: { auto: 'all' } }), excluded),
  );
});

// ---------------------------------------------------------------------------
// Case 15 — different thresholds in include vs auto lists honored
// independently
// ---------------------------------------------------------------------------

test('case 15: include and auto lists honor independent thresholds', () => {
  // semverDiff 'minor': 'patch' threshold is not reached, 'minor' is.
  const container = makeContainer({
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '1.1.0', semverDiff: 'minor' },
    actionTriggerInclude: 'docker.update:patch',
    actionTriggerAuto: 'docker.update:minor',
  });
  const trigger = makeTrigger('docker.update', { configuration: { auto: 'onauto' } });

  // Included via the (independently thresholded) auto list, not the include list.
  expect(resolveForTrigger(trigger, container)).toStrictEqual({ state: 'auto' });
});

// ---------------------------------------------------------------------------
// Case 16 — include names a different trigger -> falls through to default
// deny
// ---------------------------------------------------------------------------

test('case 16: include naming a different trigger falls through to default deny', () => {
  const trigger = makeTrigger('docker.update', { configuration: { auto: 'onauto' } });
  const container = makeContainer({ actionTriggerInclude: 'other-trigger' });

  expect(resolveForTrigger(trigger, container)).toStrictEqual({
    state: 'blocked',
    reason: 'not-included',
  });
  expect(selectActionTrigger({ 'docker.update': trigger }, container)).toBeUndefined();
});
