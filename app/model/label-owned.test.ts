import type { Container } from './container.js';
import {
  applyLabelOwnedState,
  buildLabelOwnedState,
  captureDeclaredFromFlat,
  getLabelOwnedFieldSpec,
  inferDeclaredSources,
  LABEL_OWNED_FIELDS,
  type LabelOverrideFields,
  parseLabelOverrideFields,
  parseLabelOwnedState,
  pickLabelOwnedFlat,
  stripAgentLabelOwnedState,
  toDeclaredProjection,
} from './label-owned.js';

function containerWith(overrides: Record<string, unknown> = {}): Container {
  return {
    id: 'c1',
    name: 'web',
    displayName: 'web',
    displayIcon: 'mdi:docker',
    status: 'running',
    watcher: 'local',
    ...overrides,
  } as unknown as Container;
}

function override(value: unknown) {
  return { value, updatedAt: '2026-10-03T00:00:00.000Z', updatedBy: 'user:admin' };
}

/** Run the capture, inference and apply steps the store runs, over one container. */
function resolve(base: Container, overrides?: LabelOverrideFields) {
  const declared = captureDeclaredFromFlat(base);
  const state = buildLabelOwnedState(
    declared,
    inferDeclaredSources(
      declared,
      base,
      base.dependsOnSource === 'override' ? undefined : base.dependsOnSource,
    ),
    overrides,
  );
  return applyLabelOwnedState({ ...base }, state, overrides);
}

describe('model/label-owned', () => {
  test('registers the nine fields in four families with their label keys', () => {
    expect(LABEL_OWNED_FIELDS.map((spec) => [spec.field, spec.labelKey])).toEqual([
      ['displayName', 'dd.display.name'],
      ['displayIcon', 'dd.display.icon'],
      ['dependsOn', 'dd.depends_on'],
      ['dependsOnAction', 'dd.depends_on.action'],
      ['notificationTriggerInclude', 'dd.notification.include'],
      ['notificationTriggerExclude', 'dd.notification.exclude'],
      ['actionTriggerInclude', 'dd.action.include'],
      ['actionTriggerExclude', 'dd.action.exclude'],
      ['actionTriggerAuto', 'dd.action.auto'],
    ]);
    expect(getLabelOwnedFieldSpec('actionTriggerAuto')).toMatchObject({
      family: 'routing',
      category: 'action',
    });
    expect(getLabelOwnedFieldSpec('constructor')).toBeUndefined();
    expect(getLabelOwnedFieldSpec('__proto__')).toBeUndefined();
  });

  describe('declared source inference', () => {
    test.each([
      [
        'a display name equal to the label is from the label',
        { displayName: 'TV', labels: { 'dd.display.name': 'TV' } },
        'label',
      ],
      ['a display name equal to the container name is the default', {}, 'default'],
      [
        'any other display name came from watcher config',
        { displayName: 'Imgset name' },
        'watcher',
      ],
      [
        'a blank label does not claim the display name',
        { displayName: ' ', labels: { 'dd.display.name': ' ' } },
        'watcher',
      ],
    ])('%s', (_name, overrides, expected) => {
      const container = containerWith(overrides);
      const sources = inferDeclaredSources(
        captureDeclaredFromFlat(container),
        container,
        undefined,
      );
      expect(sources.displayName).toBe(expected);
    });

    test.each([
      [
        'equal to the label',
        { displayIcon: 'sh:sonarr', labels: { 'dd.display.icon': 'sh:sonarr' } },
        'label',
      ],
      ['the mdi:docker fallback', {}, 'default'],
      ['an empty icon', { displayIcon: '' }, 'default'],
      ['an imgset icon', { displayIcon: 'hl:sonarr' }, 'watcher'],
    ])('display icon %s', (_name, overrides, expected) => {
      const container = containerWith(overrides);
      expect(
        inferDeclaredSources(captureDeclaredFromFlat(container), container, undefined).displayIcon,
      ).toBe(expected);
    });

    test.each([
      [['db'], 'label', 'label'],
      [['db'], 'compose', 'compose'],
      [['db'], undefined, 'unset'],
      [undefined, 'label', 'unset'],
    ])('dependsOn %j with source %s is %s', (dependsOn, source, expected) => {
      const container = containerWith({ dependsOn });
      expect(
        inferDeclaredSources(
          captureDeclaredFromFlat(container),
          container,
          source as 'label' | 'compose' | undefined,
        ).dependsOn,
      ).toBe(expected);
    });

    test.each([
      [{ dependsOnAction: 'restart', labels: { 'dd.depends_on.action': ' Restart ' } }, 'label'],
      [{ dependsOnAction: 'update' }, 'default'],
      [{ dependsOnAction: 'update', labels: { 'dd.depends_on.action': 'bogus' } }, 'default'],
      [{}, 'unset'],
    ])('dependsOnAction %j is %s', (overrides, expected) => {
      const container = containerWith(overrides);
      expect(
        inferDeclaredSources(captureDeclaredFromFlat(container), container, undefined)
          .dependsOnAction,
      ).toBe(expected);
    });

    test.each([
      [{ actionTriggerInclude: 'slack.a', labels: { 'dd.action.include': 'slack.a' } }, 'label'],
      [{ actionTriggerInclude: 'slack.a' }, 'watcher'],
      [{}, 'unset'],
    ])('a routing field %j is %s', (overrides, expected) => {
      const container = containerWith(overrides);
      expect(
        inferDeclaredSources(captureDeclaredFromFlat(container), container, undefined)
          .actionTriggerInclude,
      ).toBe(expected);
    });
  });

  describe('resolution', () => {
    const base = containerWith({
      displayName: 'Sonarr',
      displayIcon: 'sh:sonarr',
      dependsOn: ['db'],
      dependsOnSource: 'compose',
      dependsOnAction: 'update',
      notificationTriggerInclude: 'slack.a',
      notificationTriggerExclude: 'smtp.b',
      actionTriggerInclude: 'docker.local',
      actionTriggerExclude: 'docker.other',
      actionTriggerAuto: 'docker.local:minor',
      labels: { 'dd.display.name': 'Sonarr', 'dd.action.include': 'docker.local' },
    });

    test('with no overrides every field keeps its declared value and source', () => {
      const resolved = resolve(base);
      expect(pickLabelOwnedFlat(resolved)).toEqual(pickLabelOwnedFlat(base));
      expect(resolved.labelOwned?.sources).toEqual({
        displayName: 'label',
        displayIcon: 'watcher',
        dependsOn: 'compose',
        dependsOnAction: 'default',
        notificationTriggerInclude: 'watcher',
        notificationTriggerExclude: 'watcher',
        actionTriggerInclude: 'label',
        actionTriggerExclude: 'watcher',
        actionTriggerAuto: 'watcher',
      });
    });

    test('an override replaces the declared value of its field and nothing else', () => {
      const resolved = resolve(base, {
        displayName: override('TV'),
        displayIcon: override('si:tv'),
        dependsOn: override(['api', 'cache']),
        dependsOnAction: override('restart'),
        notificationTriggerInclude: override(['discord.team', 'slack.a:major']),
        actionTriggerAuto: override(['docker.local']),
      });
      expect(resolved).toMatchObject({
        displayName: 'TV',
        displayIcon: 'si:tv',
        dependsOn: ['api', 'cache'],
        dependsOnSource: 'override',
        dependsOnAction: 'restart',
        notificationTriggerInclude: 'discord.team,slack.a:major',
        actionTriggerAuto: 'docker.local',
        // Untouched fields keep the declared value.
        notificationTriggerExclude: 'smtp.b',
        actionTriggerInclude: 'docker.local',
        actionTriggerExclude: 'docker.other',
      });
      expect(resolved.labelOwned?.sources).toMatchObject({
        displayName: 'override',
        dependsOn: 'override',
        actionTriggerInclude: 'label',
        actionTriggerExclude: 'watcher',
      });
      // The declared layer is never touched by an override.
      expect(resolved.labelOwned?.declared.displayName).toBe('Sonarr');
      expect(resolved.labelOwned?.declared.dependsOn).toEqual(['db']);
      expect(resolved.labelOwned?.declaredSources.dependsOn).toBe('compose');
    });

    test('an empty-list override is an explicit none, not a fall-through to the label', () => {
      const resolved = resolve(base, {
        actionTriggerInclude: override([]),
        notificationTriggerExclude: override([]),
        dependsOn: override([]),
      });
      expect(resolved.actionTriggerInclude).toBeUndefined();
      expect(resolved.notificationTriggerExclude).toBeUndefined();
      expect(resolved.dependsOn).toEqual([]);
      expect(resolved.dependsOnSource).toBe('override');
      expect(resolved.labelOwned?.sources).toMatchObject({
        actionTriggerInclude: 'override',
        notificationTriggerExclude: 'override',
        dependsOn: 'override',
      });
    });

    test('lists replace whole and never merge, and the override never aliases its source', () => {
      const overrides = { dependsOn: override(['api']) };
      const resolved = resolve(base, overrides);
      expect(resolved.dependsOn).toEqual(['api']);
      resolved.dependsOn?.push('mutated');
      expect(overrides.dependsOn.value).toEqual(['api']);
    });

    test('dropping the override restores the declared source for dependencies', () => {
      expect(resolve(base).dependsOnSource).toBe('compose');
      const unset = resolve(containerWith({ displayName: 'web' }));
      expect(unset.dependsOnSource).toBeUndefined();
      expect(unset.dependsOn).toBeUndefined();
    });
  });

  describe('declared projection', () => {
    test('a record with no state is returned as is', () => {
      const container = containerWith();
      expect(toDeclaredProjection(container)).toBe(container);
    });

    test('shows the declared values, the declared dependency source, and leaves the original alone', () => {
      const base = containerWith({
        displayName: 'Sonarr',
        dependsOn: ['db'],
        dependsOnSource: 'label',
        actionTriggerInclude: 'docker.local',
      });
      const effective = resolve(base, {
        displayName: override('TV'),
        dependsOn: override(['api']),
        actionTriggerInclude: override([]),
      });
      expect(effective.displayName).toBe('TV');

      const projected = toDeclaredProjection(effective);
      expect(projected).not.toBe(effective);
      expect(projected).toMatchObject({
        displayName: 'Sonarr',
        dependsOn: ['db'],
        dependsOnSource: 'label',
        actionTriggerInclude: 'docker.local',
      });
      expect(effective.displayName).toBe('TV');

      projected.dependsOn?.push('x');
      expect(effective.labelOwned?.declared.dependsOn).toEqual(['db']);
    });

    test('an unset declared dependency source projects to no source', () => {
      const projected = toDeclaredProjection(
        resolve(containerWith({ dependsOn: ['db'] }), { dependsOn: override(['api']) }),
      );
      expect(projected.dependsOnSource).toBeUndefined();
    });
  });

  describe('stored documents', () => {
    test('parseLabelOverrideFields keeps readable fields and reports the rest', () => {
      const parsed = parseLabelOverrideFields(
        JSON.stringify({
          displayName: override('TV'),
          displayIcon: override(''),
          dependsOn: override(['a']),
          dependsOnAction: override('explode'),
          actionTriggerAuto: override([]),
          notificationTriggerInclude: override('not-a-list'),
          bogus: override('x'),
          actionTriggerExclude: { value: ['a'] },
          actionTriggerInclude: null,
        }),
      );
      expect(Object.keys(parsed.fields).sort()).toEqual([
        'actionTriggerAuto',
        'dependsOn',
        'displayName',
      ]);
      expect(parsed.invalid.map((entry) => [entry.field, entry.reason])).toEqual([
        ['displayIcon', 'invalid value'],
        ['dependsOnAction', 'invalid value'],
        ['notificationTriggerInclude', 'invalid value'],
        ['bogus', 'unknown field'],
        ['actionTriggerExclude', 'invalid value'],
        ['actionTriggerInclude', 'invalid value'],
      ]);
    });

    test('parseLabelOverrideFields never throws on an unreadable document', () => {
      expect(parseLabelOverrideFields('{nope')).toEqual({
        fields: {},
        invalid: [{ field: '*', reason: 'not valid JSON' }],
      });
      expect(parseLabelOverrideFields('[]').invalid).toEqual([
        { field: '*', reason: 'not an object' },
      ]);
      expect(parseLabelOverrideFields(null).invalid).toEqual([
        { field: '*', reason: 'not an object' },
      ]);
    });

    test('parseLabelOverrideFields cannot be tricked into a prototype write', () => {
      const parsed = parseLabelOverrideFields(
        '{"__proto__":{"value":"x","updatedAt":"a","updatedBy":"b"}}',
      );
      expect(parsed.fields).toEqual({});
      expect(({} as Record<string, unknown>).value).toBeUndefined();
    });

    test('parseLabelOwnedState reads a state it built back whole', () => {
      const state = resolve(containerWith()).labelOwned;
      expect(parseLabelOwnedState(JSON.parse(JSON.stringify(state)))).toEqual({
        state,
        unknown: [],
      });
    });

    test.each([
      ['undefined', undefined],
      ['a string', 'x'],
      ['an array', []],
      ['an unknown version', { v: 2 }],
    ])('parseLabelOwnedState reads %s as every field unknown, never throwing', (_name, raw) => {
      const { state, unknown } = parseLabelOwnedState(raw);
      expect(unknown).toHaveLength(9);
      expect(state.declared).toEqual({});
      expect(Object.values(state.sources)).toEqual(Array(9).fill('unset'));
    });

    test('parseLabelOwnedState flags only the fields it cannot read', () => {
      const state = resolve(containerWith({ displayName: 'Sonarr' })).labelOwned as LabelOwnedState;
      const raw = JSON.parse(JSON.stringify(state));
      delete raw.sources.dependsOn;
      raw.declaredSources.displayIcon = 'bogus';
      raw.declared.dependsOnAction = 7;
      const parsed = parseLabelOwnedState(raw);
      expect(parsed.unknown.sort()).toEqual(['dependsOn', 'dependsOnAction', 'displayIcon']);
      expect(parsed.state.declared.displayName).toBe('Sonarr');
      expect(parsed.state.declared.dependsOnAction).toBeUndefined();
      expect(parsed.state.declaredSources.displayIcon).toBe('unset');
      expect(parseLabelOwnedState({ ...raw, declared: null }).unknown).toHaveLength(9);
    });
  });

  describe('agent payloads', () => {
    test('a payload with no state and no override source is returned as is', () => {
      const container = containerWith({ dependsOnSource: 'label' });
      expect(stripAgentLabelOwnedState(container)).toBe(container);
    });

    test('state and a claimed override source are stripped without touching the original', () => {
      const payload = resolve(containerWith({ dependsOn: ['db'] }), {
        dependsOn: override(['x']),
      });
      expect(payload.dependsOnSource).toBe('override');

      const stripped = stripAgentLabelOwnedState(payload);

      expect(stripped).not.toHaveProperty('labelOwned');
      expect(stripped.dependsOnSource).toBeUndefined();
      expect(stripped.dependsOn).toEqual(['x']);
      expect(payload.labelOwned).toBeDefined();
    });

    test('state alone is stripped and a real source is kept', () => {
      const payload = {
        ...resolve(containerWith({ dependsOn: ['db'], dependsOnSource: 'compose' })),
      };
      expect(payload.labelOwned).toBeDefined();
      const stripped = stripAgentLabelOwnedState(payload);
      expect(stripped).not.toHaveProperty('labelOwned');
      expect(stripped.dependsOnSource).toBe('compose');
    });
  });
});
