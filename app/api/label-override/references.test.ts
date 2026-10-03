import type { Container } from '../../model/container.js';
import {
  checkAgentRestriction,
  checkRoutingReferences,
  evaluateDependencyOverride,
  isAgentEnforcedWatcher,
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

    test('an include may only narrow, and an empty list lifts the restriction', () => {
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

    test('an include against no declared restriction is always a narrowing', () => {
      expect(check('actionTriggerInclude', ['docker'], undefined)).toBeUndefined();
      expect(check('actionTriggerInclude', ['docker'], '  ')).toBeUndefined();
      expect(check('actionTriggerInclude', [], undefined)).toBeUndefined();
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

  describe('isAgentEnforcedWatcher', () => {
    const traditional = { type: 'docker', name: 'local', agent: 'edge', configuration: {} };
    const portwing = {
      type: 'docker',
      name: 'host',
      agent: 'pw',
      configuration: { transport: 'docker-api', execution: 'controller', events: 'portwing' },
    };
    const state = { 'edge.docker.local': traditional, 'pw.docker.host': portwing };

    test('a controller-local container is never enforced', () => {
      expect(isAgentEnforcedWatcher({ agent: undefined, watcher: 'local' }, state)).toBe(false);
      expect(isAgentEnforcedWatcher({ agent: '', watcher: 'local' }, state)).toBe(false);
    });

    test('a traditional agent is enforced and a Portwing controller transport is not', () => {
      expect(isAgentEnforcedWatcher({ agent: 'edge', watcher: 'local' }, state)).toBe(true);
      expect(isAgentEnforcedWatcher({ agent: 'pw', watcher: 'host' }, state)).toBe(false);
    });

    test('an agent whose watcher is not registered is treated as enforced', () => {
      expect(isAgentEnforcedWatcher({ agent: 'gone', watcher: 'local' }, state)).toBe(true);
      expect(isAgentEnforcedWatcher({ agent: 'edge', watcher: 'local' }, undefined)).toBe(true);
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
