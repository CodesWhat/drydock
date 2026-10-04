import { type ActionPolicyTrigger, resolveForTrigger } from '../../model/action-policy.js';
import type { Container } from '../../model/container.js';
import {
  checkAgentRestriction,
  checkRoutingReferences,
  evaluateDependencyOverride,
  toTriggerInfos,
} from './references.js';

function trigger(id: string, type: string, extras: Record<string, unknown> = {}) {
  return { type, name: id.split('.').at(-1), getId: () => id, ...extras };
}

const TRIGGERS = toTriggerInfos({
  'docker.local': trigger('docker.local', 'docker', { configuration: { auto: 'onauto' } }),
  'dockercompose.stack': trigger('dockercompose.stack', 'dockercompose', {
    configuration: { auto: true },
  }),
  'docker.edge': { ...trigger('edge.docker.edge', 'docker'), agent: 'edge', configuration: {} },
  // No getId: the registry key is the id.
  'slack.ops': { type: 'slack', name: 'ops', configuration: { auto: false } },
  'command.hook': trigger('command.hook', 'command', { configuration: { auto: 'none' } }),
});

describe('api/label-override/references', () => {
  describe('toTriggerInfos', () => {
    test('reads id, type, agent and a normalized auto mode, tolerating an empty registry', () => {
      expect(toTriggerInfos(undefined)).toEqual([]);
      expect(TRIGGERS).toEqual([
        { id: 'docker.local', type: 'docker', agent: undefined, auto: 'onauto' },
        { id: 'dockercompose.stack', type: 'dockercompose', agent: undefined, auto: 'all' },
        { id: 'edge.docker.edge', type: 'docker', agent: 'edge', auto: 'all' },
        { id: 'slack.ops', type: 'slack', agent: undefined, auto: 'none' },
        { id: 'command.hook', type: 'command', agent: undefined, auto: 'none' },
      ]);
    });

    test('a trigger with no configuration at all auto-runs everything', () => {
      expect(
        toTriggerInfos({ 'docker.bare': { type: 'docker', getId: () => 'docker.bare' } }),
      ).toEqual([{ id: 'docker.bare', type: 'docker', agent: undefined, auto: 'all' }]);
    });
  });

  describe('checkRoutingReferences', () => {
    const run = (field: string, entries: string[], agent?: string) =>
      checkRoutingReferences(field, entries, TRIGGERS, { agent });

    test('accepts references that match a trigger of the field category by id, name or provider.name', () => {
      expect(
        run('actionTriggerInclude', ['docker.local', 'stack:major', 'dockercompose.stack']),
      ).toEqual({
        errors: [],
        warnings: [],
      });
      expect(run('notificationTriggerExclude', ['ops', 'SLACK.OPS:minor'])).toEqual({
        errors: [],
        warnings: [],
      });
    });

    test('rejects a reference that matches nothing, and one that only matches the other category', () => {
      expect(run('actionTriggerInclude', ['docker.local', 'ghost', 'ops:major'])).toEqual({
        errors: [
          { field: 'actionTriggerInclude', code: 'unknown-trigger-reference', entries: ['ghost'] },
          { field: 'actionTriggerInclude', code: 'wrong-trigger-category', entries: ['ops:major'] },
        ],
        warnings: [],
      });
      expect(run('notificationTriggerInclude', ['docker.local'])).toEqual({
        errors: [
          {
            field: 'notificationTriggerInclude',
            code: 'wrong-trigger-category',
            entries: ['docker.local'],
          },
        ],
        warnings: [],
      });
    });

    test('an empty list is always valid', () => {
      expect(run('actionTriggerAuto', [])).toEqual({ errors: [], warnings: [] });
    });

    test('warns when an action reference only matches triggers of another agent', () => {
      expect(run('actionTriggerInclude', ['docker.edge'], undefined).warnings).toEqual([
        { field: 'actionTriggerInclude', code: 'trigger-agent-mismatch', reference: 'docker.edge' },
      ]);
      expect(run('actionTriggerInclude', ['docker.edge'], 'edge').warnings).toEqual([]);
      expect(run('actionTriggerInclude', ['docker.local'], 'edge').warnings).toEqual([
        {
          field: 'actionTriggerInclude',
          code: 'trigger-agent-mismatch',
          reference: 'docker.local',
        },
      ]);
    });

    test('notification references never warn about agents', () => {
      expect(run('notificationTriggerInclude', ['ops'], 'edge').warnings).toEqual([]);
    });

    test('warns when no matching trigger runs onauto for an auto reference', () => {
      expect(run('actionTriggerAuto', ['docker.local']).warnings).toEqual([]);
      expect(run('actionTriggerAuto', ['stack', 'docker.local'])).toEqual({
        errors: [],
        warnings: [{ field: 'actionTriggerAuto', code: 'auto-inert', reference: 'stack' }],
      });
    });
  });

  describe('checkAgentRestriction', () => {
    const check = (field: string, entries: string[], declared: string | undefined) =>
      checkAgentRestriction(field, entries, declared);

    test('an exclude must keep every declared entry', () => {
      expect(
        check('actionTriggerExclude', ['docker', 'slack'], 'Docker, slack:all'),
      ).toBeUndefined();
      expect(check('actionTriggerExclude', ['slack'], 'docker:major, slack')).toEqual({
        field: 'actionTriggerExclude',
        code: 'agent-enforced-widening',
        entries: ['docker:major'],
      });
      expect(check('actionTriggerExclude', ['docker'], 'docker:major')).toEqual({
        field: 'actionTriggerExclude',
        code: 'agent-enforced-widening',
        entries: ['docker:major'],
      });
      expect(check('actionTriggerExclude', [], undefined)).toBeUndefined();
      expect(check('actionTriggerExclude', ['docker'], undefined)).toBeUndefined();
      expect(check('actionTriggerExclude', [], 'docker')?.entries).toEqual(['docker:all']);
    });

    test('an include may only narrow, and an empty list is not a way to drop the restriction', () => {
      expect(check('actionTriggerInclude', ['docker:major'], 'docker:major,slack')).toBeUndefined();
      expect(check('actionTriggerInclude', ['docker', 'other'], 'docker')).toEqual({
        field: 'actionTriggerInclude',
        code: 'agent-enforced-widening',
        entries: ['other:all'],
      });
      expect(check('actionTriggerInclude', [], 'docker,slack')).toEqual({
        field: 'actionTriggerInclude',
        code: 'agent-enforced-widening',
        entries: ['docker:all', 'slack:all'],
      });
    });

    test('an include against no declared include allows only an empty override', () => {
      // Under AUTO=oninclude an empty include means nothing is included, so any entry grants.
      expect(check('actionTriggerInclude', ['docker'], undefined)).toEqual({
        field: 'actionTriggerInclude',
        code: 'agent-enforced-widening',
        entries: ['docker:all'],
      });
      expect(check('actionTriggerInclude', ['docker:major'], '  ')?.entries).toEqual([
        'docker:major',
      ]);
      expect(check('actionTriggerInclude', [], undefined)).toBeUndefined();
      expect(check('actionTriggerInclude', [], '  ')).toBeUndefined();
    });

    test('an exclude must carry the declared entries as an exact prefix', () => {
      expect(
        check('actionTriggerExclude', ['docker.edge:major-only', 'docker.edge'], 'docker.edge'),
      ).toEqual({
        field: 'actionTriggerExclude',
        code: 'agent-enforced-widening',
        entries: ['docker.edge:all'],
      });
      expect(
        check('actionTriggerExclude', ['docker.edge', 'docker.edge:major-only'], 'docker.edge'),
      ).toBeUndefined();
      expect(check('actionTriggerExclude', ['b', 'a'], 'a,b')?.entries).toEqual(['a:all', 'b:all']);
    });

    test('an include entry may not shadow a declared entry with a wider threshold', () => {
      expect(check('actionTriggerInclude', ['docker.edge:all'], 'docker.edge:major')).toEqual({
        field: 'actionTriggerInclude',
        code: 'agent-enforced-widening',
        entries: ['docker.edge:all'],
      });
      expect(check('actionTriggerInclude', ['docker.edge:major'], 'docker.edge')).toBeUndefined();
      // `edge` is declared first and matches the same trigger, so docker.edge:all would widen it.
      expect(
        check('actionTriggerInclude', ['docker.edge:all'], 'edge:major,docker.edge:all')?.entries,
      ).toEqual(['docker.edge:all']);
      expect(check('actionTriggerAuto', ['edge:all'], 'docker.edge:all')?.entries).toEqual([
        'edge:all',
      ]);
    });

    describe('never widens what resolveForTrigger returns', () => {
      const RANK = { blocked: 0, manual: 1, auto: 2 } as const;
      const DIFFS = ['major', 'minor', 'patch'] as const;
      const MODES = ['all', 'oninclude', 'onauto', 'none'] as const;
      const TRIGGER_IDS = ['docker.edge', 'docker.other'] as const;

      function outcomes(
        flat: Partial<Container>,
        mode: (typeof MODES)[number],
        triggerId: string,
      ): number[] {
        const candidate = {
          type: 'docker',
          getId: () => triggerId,
          configuration: { auto: mode },
        } as unknown as ActionPolicyTrigger;
        return DIFFS.map(
          (semverDiff) =>
            RANK[
              resolveForTrigger(candidate, {
                id: 'c1',
                name: 'web',
                watcher: 'local',
                updateKind: { kind: 'tag', localValue: '1', remoteValue: '2', semverDiff },
                ...flat,
              } as unknown as Container).state
            ],
        );
      }

      const flatOf = (field: string, entries: string[]) => ({
        [field]: entries.length === 0 ? undefined : entries.join(','),
      });

      function widens(field: string, declared: string | undefined, entries: string[]): boolean {
        // The declared layer sets the other routing fields to what the agent's labels would
        // grant, so a narrowing in one field is judged on its own.
        const base =
          field === 'actionTriggerExclude'
            ? { actionTriggerInclude: 'docker.edge,docker.other', actionTriggerAuto: 'docker.edge' }
            : field === 'actionTriggerInclude'
              ? { actionTriggerAuto: undefined }
              : { actionTriggerInclude: 'docker.edge,docker.other' };
        return MODES.some((mode) =>
          TRIGGER_IDS.some((triggerId) => {
            const before = outcomes({ ...base, [field]: declared || undefined }, mode, triggerId);
            const after = outcomes({ ...base, ...flatOf(field, entries) }, mode, triggerId);
            return after.some((value, index) => value > before[index]);
          }),
        );
      }

      const ENTRIES = ['docker.edge', 'edge', 'docker.other', 'other'].flatMap((id) =>
        ['', ':major-only', ':minor', ':all'].map((threshold) => `${id}${threshold}`),
      );
      const LISTS = [[], ...ENTRIES.map((entry) => [entry])].concat(
        ENTRIES.flatMap((first) => ENTRIES.map((second) => [first, second])),
      );
      const DECLARED = [
        undefined,
        'docker.edge',
        'docker.edge:major-only',
        'edge:minor,docker.edge',
        'docker.edge:minor,docker.other',
        'docker.edge:major-only,docker.edge',
      ];

      test('blocked stays blocked when an agent container has no include label', () => {
        expect(outcomes({ actionTriggerInclude: undefined }, 'oninclude', 'docker.edge')).toEqual([
          0, 0, 0,
        ]);
        expect(check('actionTriggerInclude', ['docker.edge'], undefined)).toBeDefined();
        expect(widens('actionTriggerInclude', undefined, ['docker.edge'])).toBe(true);
      });

      test('an exclude that un-excludes minor updates is the case the check catches', () => {
        const entries = ['docker.edge:major-only', 'docker.edge'];
        expect(widens('actionTriggerExclude', 'docker.edge', entries)).toBe(true);
        expect(check('actionTriggerExclude', entries, 'docker.edge')).toBeDefined();
      });

      test.each(['actionTriggerExclude', 'actionTriggerInclude', 'actionTriggerAuto'])(
        'every override %s the check allows keeps every outcome at or below the declared one',
        (field) => {
          for (const declared of DECLARED) {
            for (const entries of LISTS) {
              if (check(field, entries, declared) === undefined) {
                expect({
                  field,
                  declared,
                  entries,
                  widens: widens(field, declared, entries),
                }).toEqual({ field, declared, entries, widens: false });
              }
            }
          }
        },
      );
    });

    test('an auto list must be a subset of the declared one, and an empty list always is', () => {
      expect(check('actionTriggerAuto', ['docker'], 'docker,slack')).toBeUndefined();
      expect(check('actionTriggerAuto', [], undefined)).toBeUndefined();
      expect(check('actionTriggerAuto', ['docker'], undefined)).toEqual({
        field: 'actionTriggerAuto',
        code: 'agent-enforced-widening',
        entries: ['docker:all'],
      });
    });

    test('fields the agent does not enforce are never restricted', () => {
      expect(check('notificationTriggerInclude', ['slack'], undefined)).toBeUndefined();
      expect(check('displayName', ['x'], undefined)).toBeUndefined();
    });

    test('an unparseable declared threshold reads as all, the way the agent reads it', () => {
      expect(check('actionTriggerAuto', ['docker'], 'docker:bogus')).toBeUndefined();
    });
  });

  describe('evaluateDependencyOverride', () => {
    function container(id: string, name: string, extras: Partial<Container> = {}): Container {
      return { id, name, watcher: 'local', labels: {}, ...extras } as Container;
    }

    const web1 = container('w1', 'media-web-1', {
      labels: { 'com.docker.compose.project': 'media', 'com.docker.compose.service': 'web' },
    });
    const web2 = container('w2', 'media-web-2', { labels: web1.labels });
    const db = container('d1', 'db');
    const cache = container('c1', 'cache', {
      dependsOn: ['media-web-1'],
      dependsOnSource: 'label',
    });
    const remote = container('r1', 'queue', { agent: 'edge' });
    const all = [web1, web2, db, cache, remote];
    const scope = new Set(['w1', 'w2']);
    const run = (names: string[], containers = all) =>
      evaluateDependencyOverride(names, scope, containers);

    test('an empty list and resolved names are clean', () => {
      expect(run([])).toEqual({ errors: [], warnings: [] });
      expect(run(['db'])).toEqual({ errors: [], warnings: [] });
    });

    test('rejects a name that is any container of the scope, replicas included', () => {
      expect(run(['db', 'media-web-2', 'media-web-1'])).toEqual({
        errors: [
          { field: 'dependsOn', code: 'depends-on-self', entries: ['media-web-2', 'media-web-1'] },
        ],
        warnings: [],
      });
    });

    test('warns about unresolved names and names that only exist on another agent', () => {
      expect(run(['db', 'ghost', 'queue'])).toEqual({
        errors: [],
        warnings: [
          { field: 'dependsOn', code: 'unresolved-dependency', reference: 'ghost' },
          { field: 'dependsOn', code: 'cross-host-dependency', reference: 'queue' },
        ],
      });
    });

    test('reports each unresolved name once even when every replica misses it', () => {
      expect(run(['ghost']).warnings).toEqual([
        { field: 'dependsOn', code: 'unresolved-dependency', reference: 'ghost' },
      ]);
    });

    test('rejects a dependency that closes a new cycle and names its members', () => {
      expect(run(['cache'])).toEqual({
        errors: [],
        warnings: [],
        cycle: ['cache', 'media-web-1'],
      });
    });

    test('a cycle that already runs through the scope does not block', () => {
      const looping = container('w1', 'media-web-1', {
        labels: web1.labels,
        dependsOn: ['a'],
        dependsOnSource: 'label',
      });
      const a = container('a', 'a', { dependsOn: ['media-web-1'], dependsOnSource: 'label' });
      const result = evaluateDependencyOverride(['a', 'db'], scope, [looping, web2, db, a]);
      expect(result.cycle).toBeUndefined();
    });

    test('a cycle that already existed but grows through the scope is new', () => {
      const a = container('a', 'a', { dependsOn: ['b'], dependsOnSource: 'label' });
      const b = container('b', 'b', { dependsOn: ['a', 'media-web-1'], dependsOnSource: 'label' });
      const result = evaluateDependencyOverride(['a'], scope, [web1, web2, a, b]);
      expect(result.cycle).toEqual(['a', 'b', 'media-web-1']);
    });

    test('a cycle that does not run through the scope is not this override', () => {
      const a = container('a', 'a', { dependsOn: ['b'], dependsOnSource: 'label' });
      const b = container('b', 'b', { dependsOn: ['a'], dependsOnSource: 'label' });
      const stranger = container('s', 's');
      const result = evaluateDependencyOverride(['db'], new Set(['s']), [stranger, a, b, db]);
      expect(result.cycle).toBeUndefined();
    });
  });
});
