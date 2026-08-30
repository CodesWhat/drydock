import { findDockerTriggerForContainer } from '../api/docker-trigger.js';
import {
  type ActionPolicyTrigger,
  findInertAutoLabelContainers,
  findOnincludeAutoMigrationGaps,
  resolveForTrigger,
  selectActionTrigger,
} from './action-policy.js';
import type { Container } from './container.js';

vi.mock('../log/index.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

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

// ---------------------------------------------------------------------------
// resolveForTrigger — migration table (spec-6.0.1-action-policy.md)
//
// `onauto` cannot pre-exist, so these 8 rows are exhaustive for upgrades.
// Each test asserts the POST-6.0.1 resolver state; the resolver has no
// notion of severity (that stays a call-site/BLOCKER_SEVERITY concern), so
// "blocked" here covers both the soft-blocked and hard-blocked pre/post rows.
// ---------------------------------------------------------------------------

describe('resolveForTrigger — migration table', () => {
  test('row 1: all + any include + no exclude -> auto (access+auto, unchanged)', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'all' } });
    const container = makeContainer({ actionTriggerInclude: 'docker.update' });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({ state: 'auto' });
  });

  test('row 2: all + any include + exclude -> blocked (unchanged)', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'all' } });
    const container = makeContainer({
      actionTriggerInclude: 'docker.update',
      actionTriggerExclude: 'docker.update',
    });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({
      state: 'blocked',
      reason: 'excluded',
    });
  });

  test('row 3: none + any include + no exclude + any auto label -> manual (unchanged)', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'none' } });
    const container = makeContainer({
      actionTriggerInclude: 'docker.update',
      actionTriggerAuto: 'docker.update',
    });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({ state: 'manual' });
  });

  test('row 4: none + any include + exclude + any auto label -> blocked (unchanged)', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'none' } });
    const container = makeContainer({
      actionTriggerInclude: 'docker.update',
      actionTriggerAuto: 'docker.update',
      actionTriggerExclude: 'docker.update',
    });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({
      state: 'blocked',
      reason: 'excluded',
    });
  });

  test('row 5: oninclude + absent include + no exclude -> blocked (item-7 hard flip is slice 6)', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });
    const container = makeContainer();
    expect(resolveForTrigger(trigger, container)).toStrictEqual({
      state: 'blocked',
      reason: 'not-included',
    });
  });

  test('row 6: oninclude + matching include + no exclude -> auto (load-bearing, unchanged)', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });
    const container = makeContainer({ actionTriggerInclude: 'docker.update' });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({ state: 'auto' });
  });

  test('row 7: oninclude + matching include + exclude -> blocked (unchanged)', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });
    const container = makeContainer({
      actionTriggerInclude: 'docker.update',
      actionTriggerExclude: 'docker.update',
    });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({
      state: 'blocked',
      reason: 'excluded',
    });
  });

  test('row 8: oninclude + include present but no match + no exclude -> blocked for this trigger', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });
    const container = makeContainer({ actionTriggerInclude: 'other.trigger' });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({
      state: 'blocked',
      reason: 'not-included',
    });
  });
});

// ---------------------------------------------------------------------------
// resolveForTrigger — regression matrix cases 1-4, 13-16
// (5-10 are multi-trigger walk cases, covered under selectActionTrigger below)
// ---------------------------------------------------------------------------

describe('resolveForTrigger — regression matrix', () => {
  test('case 1: oninclude default, no labels -> blocked, no auto fire', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });
    expect(resolveForTrigger(trigger, makeContainer())).toStrictEqual({
      state: 'blocked',
      reason: 'not-included',
    });
  });

  test('case 2: include only resolves manual under onauto, auto under frozen oninclude', () => {
    const container = makeContainer({ actionTriggerInclude: 'docker.update' });
    expect(
      resolveForTrigger(
        makeTrigger('docker.update', { configuration: { auto: 'onauto' } }),
        container,
      ),
    ).toStrictEqual({ state: 'manual' });
    expect(
      resolveForTrigger(
        makeTrigger('docker.update', { configuration: { auto: 'oninclude' } }),
        container,
      ),
    ).toStrictEqual({ state: 'auto' });
  });

  test('case 3: dd.action.auto alone grants manual+auto access under onauto (decision 2)', () => {
    // No actionTriggerInclude at all — access comes from the auto label alone.
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'onauto' } });
    const container = makeContainer({ actionTriggerAuto: 'docker.update' });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({ state: 'auto' });
  });

  test('case 4: exclude beats include+auto -> blocked, excluded', () => {
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
  });

  test('case 13: AUTO=none caps at manual even with a matching dd.action.auto label (fail closed)', () => {
    // The startup migration/fail-closed WARN itself is slice 5 surface
    // (startup WARNs); this asserts the state behavior the WARN would be
    // reporting on.
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'none' } });
    const container = makeContainer({ actionTriggerAuto: 'docker.update' });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({ state: 'manual' });
  });

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

  test('case 16: include naming a different trigger falls through to default deny', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'onauto' } });
    const container = makeContainer({ actionTriggerInclude: 'other-trigger' });
    expect(resolveForTrigger(trigger, container)).toStrictEqual({
      state: 'blocked',
      reason: 'not-included',
    });
  });
});

// ---------------------------------------------------------------------------
// selectActionTrigger — hybrid multi-trigger walk (decision 3) and
// regression matrix cases 5-10
// ---------------------------------------------------------------------------

describe('selectActionTrigger — hybrid walk', () => {
  test('case 5: two compatible triggers, one authorized — the authorized one wins', () => {
    const container = makeContainer({ actionTriggerInclude: 'case5-b' });
    const triggers = {
      a: makeTrigger('case5-a', { configuration: { auto: 'oninclude' } }), // not included
      b: makeTrigger('case5-b', { configuration: { auto: 'oninclude' } }), // included
    };
    const result = selectActionTrigger(triggers, container);
    expect(result?.triggerId).toBe('case5-b');
    expect(result?.state).toBe('auto');
  });

  test('case 6: two auto-authorized triggers — only the ranked winner is returned', () => {
    const container = makeContainer();
    const triggers = {
      first: makeTrigger('case6-first', { configuration: { auto: 'all' } }),
      second: makeTrigger('case6-second', { configuration: { auto: 'all' } }),
    };
    const result = selectActionTrigger(triggers, container, { requireAuto: true });
    expect(result?.triggerId).toBe('case6-first');
    expect(result?.state).toBe('auto');
    // The resolver-level precondition for double-dispatch closure: exactly one
    // winner is ever returned for a given container. The dispatch-side
    // assertion ("second handler never invoked") requires real dispatching
    // trigger instances and belongs to the auto-dispatch wiring slice.
  });

  test('case 7: exclude on the higher-ranked trigger hard-stops past a permissive catch-all', () => {
    const container = makeContainer({ actionTriggerExclude: 'case7-specific' });
    const triggers = {
      specific: makeTrigger('case7-specific', { configuration: { auto: 'all' } }),
      catchAll: makeTrigger('case7-catch-all', { configuration: { auto: 'all' } }),
    };
    const result = selectActionTrigger(triggers, container);
    expect(result).toStrictEqual({
      state: 'blocked',
      reason: 'excluded',
      trigger: triggers.specific,
      triggerId: 'case7-specific',
    });
  });

  test('case 8: not-included on the higher-ranked trigger falls through to an authorized catch-all', () => {
    const container = makeContainer({ actionTriggerInclude: 'case8-catch-all' });
    const triggers = {
      specific: makeTrigger('case8-specific', { configuration: { auto: 'oninclude' } }),
      catchAll: makeTrigger('case8-catch-all', { configuration: { auto: 'oninclude' } }),
    };
    const result = selectActionTrigger(triggers, container);
    expect(result?.triggerId).toBe('case8-catch-all');
    expect(result?.state).toBe('auto');
  });

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
    const result = selectActionTrigger(triggers, container);
    expect(result?.triggerId).toBe('dockercompose.monitoring');
  });

  test('a compose trigger with a configured file but no compose labels on the container still ranks catch-all', () => {
    // getDockerTriggerSpecificity mirrors isComposeTriggerCompatibleWithContainer's
    // "no compose files reported for this container" fallback: compatible (and
    // thus a candidate), but ranked as compose-catch-all rather than
    // compose-file-matched since there is nothing to verify against.
    const container = makeContainer();
    const trigger = makeTrigger('case9c-configured-no-labels', {
      type: 'dockercompose',
      configuration: { auto: 'all' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring/compose.yaml',
      getComposeFilesForContainer: () => [],
    });
    const result = selectActionTrigger({ trigger }, container);
    expect(result?.triggerId).toBe('case9c-configured-no-labels');
    expect(result?.state).toBe('auto');
  });

  test('case 9b: ambiguous compose-suffix match stays conservative (not selected)', () => {
    // Mirrors docker-trigger.test.ts's compatibility-layer ambiguous-suffix
    // fixture — proves the conservative behavior flows through unmodified
    // via isTriggerCompatibleWithContainer (reused, not reimplemented).
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
    const result = selectActionTrigger({ 'dockercompose.ambiguous': ambiguous }, container);
    expect(result).toBeUndefined();
  });

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
});

describe('selectActionTrigger — requireAuto', () => {
  test('without requireAuto, the first ranked non-blocked candidate wins even when manual', () => {
    const container = makeContainer({ actionTriggerInclude: 'req-manual,req-auto' });
    const triggers = {
      manual: makeTrigger('req-manual', { configuration: { auto: 'onauto' } }), // no auto-label match
      auto: makeTrigger('req-auto', { configuration: { auto: 'all' } }),
    };
    const result = selectActionTrigger(triggers, container, { requireAuto: false });
    expect(result?.triggerId).toBe('req-manual');
    expect(result?.state).toBe('manual');
  });

  test('with requireAuto, a manual-only candidate is skipped in favor of a lower-ranked auto candidate', () => {
    const container = makeContainer({ actionTriggerInclude: 'req-manual,req-auto' });
    const triggers = {
      manual: makeTrigger('req-manual', { configuration: { auto: 'onauto' } }),
      auto: makeTrigger('req-auto', { configuration: { auto: 'all' } }),
    };
    const result = selectActionTrigger(triggers, container, { requireAuto: true });
    expect(result?.triggerId).toBe('req-auto');
    expect(result?.state).toBe('auto');
  });

  test('with requireAuto, returns undefined when every candidate resolves manual', () => {
    const container = makeContainer({ actionTriggerInclude: 'req2-manual' });
    const triggers = {
      manual: makeTrigger('req2-manual', { configuration: { auto: 'onauto' } }),
    };
    expect(selectActionTrigger(triggers, container, { requireAuto: true })).toBeUndefined();
  });
});

describe('selectActionTrigger — triggerTypes', () => {
  test('triggerTypes excludes a higher-specificity compose candidate so a scoped docker trigger wins', () => {
    // A compose file-matched trigger normally outranks a generic docker
    // trigger (case 9 above). `triggerTypes: ['docker']` must filter the
    // compose candidate out entirely BEFORE ranking, so the docker trigger
    // wins even though it would lose the specificity walk unscoped.
    const container = makeContainer({
      labels: {
        'com.docker.compose.project.config_files': '/opt/drydock/test/monitoring/compose.yaml',
      },
    });
    const composeTrigger = makeTrigger('dockercompose.monitoring', {
      type: 'dockercompose',
      configuration: { auto: 'all' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring/compose.yaml',
      getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring/compose.yaml'],
    });
    const dockerTrigger = makeTrigger('docker.generic', { configuration: { auto: 'all' } });
    const triggers = {
      'dockercompose.monitoring': composeTrigger,
      'docker.generic': dockerTrigger,
    };

    const unscoped = selectActionTrigger(triggers, container);
    expect(unscoped?.triggerId).toBe('dockercompose.monitoring');

    const scoped = selectActionTrigger(triggers, container, { triggerTypes: ['docker'] });
    expect(scoped?.triggerId).toBe('docker.generic');
  });
});

describe('selectActionTrigger — tied-candidate WARN', () => {
  test('warns once (not twice) when equally specific candidates tie on registration order', async () => {
    const logger = (await import('../log/index.js')).default;
    // The logger mock is module-scoped and other tests above this one also
    // trip tied-candidate warnings (e.g. case 6); clear it so this test only
    // observes calls triggered by its own two selectActionTrigger calls.
    vi.mocked(logger.warn).mockClear();
    const container = makeContainer();
    const triggers = {
      first: makeTrigger('warn-first', { configuration: { auto: 'all' } }),
      second: makeTrigger('warn-second', { configuration: { auto: 'all' } }),
    };

    const first = selectActionTrigger(triggers, container);
    const second = selectActionTrigger(triggers, container);

    expect(first?.triggerId).toBe('warn-first');
    expect(second?.triggerId).toBe('warn-first');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('warn-first'));
  });

  test('does not warn when there is only one candidate at the top specificity tier', async () => {
    const logger = (await import('../log/index.js')).default;
    vi.mocked(logger.warn).mockClear();
    const container = makeContainer({
      labels: {
        'com.docker.compose.project.config_files': '/opt/drydock/test/nowarn/compose.yaml',
      },
    });
    const catchAll = makeTrigger('nowarn.catch-all', {
      type: 'dockercompose',
      configuration: { auto: 'all' },
    });
    const fileMatched = makeTrigger('nowarn.matched', {
      type: 'dockercompose',
      configuration: { auto: 'all' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/nowarn/compose.yaml',
      getComposeFilesForContainer: () => ['/opt/drydock/test/nowarn/compose.yaml'],
    });
    const triggers = { 'nowarn.catch-all': catchAll, 'nowarn.matched': fileMatched };
    selectActionTrigger(triggers, container);
    expect(selectActionTrigger(triggers, container)?.triggerId).toBe('nowarn.matched');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Equivalence with findDockerTriggerForContainer (behavior preservation)
//
// Absent onauto config and dd.action.auto labels, selectActionTrigger(...,
// {requireAuto:false}) must return the same trigger findDockerTriggerForContainer
// returns, for every scenario in docker-trigger.test.ts that exercises
// findDockerTriggerForContainer's return value. Trigger fixtures are ported
// verbatim from that file's literals, with a `getId` added (real Trigger
// instances always have one; the plain-object fixtures there don't, because
// findDockerTriggerForContainer itself never calls it).
// ---------------------------------------------------------------------------

describe('selectActionTrigger — equivalence with findDockerTriggerForContainer', () => {
  test('returns undefined when trigger map is missing', () => {
    const container = makeContainer({ id: 'c1' });
    expect(selectActionTrigger(undefined, container)).toBeUndefined();
    expect(findDockerTriggerForContainer(undefined, container)).toBeUndefined();
  });

  test('returns undefined when no docker trigger exists', () => {
    const triggers = {
      'slack.default': makeTrigger('slack.default', { type: 'slack' }),
      'http.default': makeTrigger('http.default', { type: 'http' }),
    };
    const container = makeContainer({ id: 'c1' });
    expect(selectActionTrigger(triggers, container)).toBeUndefined();
    expect(findDockerTriggerForContainer(triggers, container)).toBeUndefined();
  });

  test('includes compose triggers by default', () => {
    const composeTrigger = makeTrigger('dockercompose.default', {
      type: 'dockercompose',
      configuration: { auto: 'all' },
    });
    const triggers = { 'dockercompose.default': composeTrigger };
    const container = makeContainer({ id: 'c1' });
    expect(selectActionTrigger(triggers, container)?.trigger).toBe(composeTrigger);
    expect(findDockerTriggerForContainer(triggers, container)).toBe(composeTrigger);
  });

  test('skips docker triggers with a different agent than the container', () => {
    const nonMatching = makeTrigger('docker.wrong', {
      type: 'docker',
      agent: 'agent-b',
      configuration: { auto: 'all' },
    });
    const matching = makeTrigger('docker.right', {
      type: 'docker',
      agent: 'agent-a',
      configuration: { auto: 'all' },
    });
    const triggers = { 'docker.wrong': nonMatching, 'docker.right': matching };
    const container = makeContainer({ id: 'c1', agent: 'agent-a' });
    expect(selectActionTrigger(triggers, container)?.trigger).toBe(matching);
    expect(findDockerTriggerForContainer(triggers, container)).toBe(matching);
  });

  test('skips local docker triggers when container belongs to an agent', () => {
    const localDocker = makeTrigger('docker.local', {
      type: 'docker',
      configuration: { auto: 'all' },
    });
    const agentDocker = makeTrigger('docker.remote', {
      type: 'docker',
      agent: 'remote-1',
      configuration: { auto: 'all' },
    });
    const triggers = { 'docker.local': localDocker, 'docker.remote': agentDocker };
    const container = makeContainer({ id: 'c1', agent: 'remote-1' });
    expect(selectActionTrigger(triggers, container)?.trigger).toBe(agentDocker);
    expect(findDockerTriggerForContainer(triggers, container)).toBe(agentDocker);
  });

  test('skips an ineligible Portainer action and selects a compatible Docker action', () => {
    const portainerTrigger = makeTrigger('portainer.update', {
      type: 'portainer',
      configuration: { auto: 'all' },
    });
    const dockerTrigger = makeTrigger('docker.update', {
      type: 'docker',
      configuration: { auto: 'all' },
    });
    const triggers = {
      'portainer.update': portainerTrigger,
      'docker.update': dockerTrigger,
    };
    const container = makeContainer({
      image: { name: 'drydock' },
      labels: {
        'com.docker.compose.project': 'demo',
        'com.docker.compose.service': 'drydock',
      },
    });

    expect(selectActionTrigger(triggers, container)?.trigger).toBe(dockerTrigger);
    expect(findDockerTriggerForContainer(triggers, container)).toBe(dockerTrigger);
  });

  test('returns the first matching local docker trigger for local containers', () => {
    const firstDocker = makeTrigger('docker.first', {
      type: 'docker',
      configuration: { auto: 'all' },
    });
    const secondDocker = makeTrigger('docker.second', {
      type: 'docker',
      agent: 'remote-1',
      configuration: { auto: 'all' },
    });
    const triggers = { 'docker.first': firstDocker, 'docker.second': secondDocker };
    const container = makeContainer({ id: 'c1' });
    expect(selectActionTrigger(triggers, container)?.trigger).toBe(firstDocker);
    expect(findDockerTriggerForContainer(triggers, container)).toBe(firstDocker);
  });

  test('prefers the compose trigger whose configured file matches the container compose labels', () => {
    const mysqlComposeTrigger = makeTrigger('dockercompose.mysql', {
      type: 'dockercompose',
      configuration: { auto: 'all' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/mysql/compose.yaml',
      getComposeFilesForContainer: () => [
        '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
      ],
    });
    const monitoringComposeTrigger = makeTrigger('dockercompose.monitoring', {
      type: 'dockercompose',
      configuration: { auto: 'all' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring/compose.yaml',
      getComposeFilesForContainer: () => [
        '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
      ],
    });
    const triggers = {
      'dockercompose.mysql': mysqlComposeTrigger,
      'dockercompose.monitoring': monitoringComposeTrigger,
    };
    const container = makeContainer({
      id: 'c1',
      labels: {
        'com.docker.compose.project.config_files':
          '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
      },
    });
    expect(selectActionTrigger(triggers, container)?.trigger).toBe(monitoringComposeTrigger);
    expect(findDockerTriggerForContainer(triggers, container)).toBe(monitoringComposeTrigger);
  });
});

describe('findOnincludeAutoMigrationGaps', () => {
  test('names a container that matches include but has no matching auto label', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });
    const gapContainer = makeContainer({ id: 'c1', actionTriggerInclude: 'docker.update' });
    expect(findOnincludeAutoMigrationGaps(trigger, [gapContainer])).toStrictEqual([gapContainer]);
  });

  test('excludes a container whose include AND auto label both match (no migration gap)', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });
    const coveredContainer = makeContainer({
      id: 'c1',
      actionTriggerInclude: 'docker.update',
      actionTriggerAuto: 'docker.update',
    });
    expect(findOnincludeAutoMigrationGaps(trigger, [coveredContainer])).toStrictEqual([]);
  });

  test('excludes a container that does not match include at all', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'oninclude' } });
    const unrelatedContainer = makeContainer({ id: 'c1', actionTriggerInclude: 'other.trigger' });
    expect(findOnincludeAutoMigrationGaps(trigger, [unrelatedContainer])).toStrictEqual([]);
  });

  test('excludes a container the trigger is not compatible with (agent mismatch)', () => {
    const trigger = makeTrigger('docker.update', {
      agent: 'agent-x',
      configuration: { auto: 'oninclude' },
    });
    const wrongAgentContainer = makeContainer({
      id: 'c1',
      agent: 'agent-y',
      actionTriggerInclude: 'docker.update',
    });
    expect(findOnincludeAutoMigrationGaps(trigger, [wrongAgentContainer])).toStrictEqual([]);
  });
});

describe('findInertAutoLabelContainers', () => {
  test('names a container with a matching dd.action.auto label', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'none' } });
    const container = makeContainer({ id: 'c1', actionTriggerAuto: 'docker.update' });
    expect(findInertAutoLabelContainers(trigger, [container])).toStrictEqual([container]);
  });

  test('excludes a container with no dd.action.auto label at all', () => {
    const trigger = makeTrigger('docker.update', { configuration: { auto: 'none' } });
    const container = makeContainer({ id: 'c1' });
    expect(findInertAutoLabelContainers(trigger, [container])).toStrictEqual([]);
  });

  test('excludes a container the trigger is not compatible with (agent mismatch)', () => {
    const trigger = makeTrigger('docker.update', {
      agent: 'agent-x',
      configuration: { auto: 'none' },
    });
    const container = makeContainer({
      id: 'c1',
      agent: 'agent-y',
      actionTriggerAuto: 'docker.update',
    });
    expect(findInertAutoLabelContainers(trigger, [container])).toStrictEqual([]);
  });
});
