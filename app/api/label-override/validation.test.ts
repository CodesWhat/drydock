import { SUPPORTED_THRESHOLDS } from '../../triggers/providers/trigger-threshold.js';
import { normalizeRoutingEntry, parsePatchBody, validateOverrideValue } from './validation.js';

function set(field: string, value: unknown) {
  return { field, op: 'set', value };
}

function parse(changes: unknown, ...revision: unknown[]) {
  return parsePatchBody({
    revision: revision.length > 0 ? revision[0] : 0,
    overrideId: 'row-1',
    changes,
  });
}

function errorsOf(result: ReturnType<typeof parsePatchBody>) {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe('api/label-override/validation', () => {
  describe('request shape', () => {
    test('accepts a set and a remove and returns them typed, in order', () => {
      expect(
        parse([set('displayName', ' TV '), { field: 'actionTriggerAuto', op: 'remove' }], 3),
      ).toEqual({
        ok: true,
        revision: 3,
        overrideId: 'row-1',
        changes: [
          { field: 'displayName', op: 'set', value: 'TV' },
          { field: 'actionTriggerAuto', op: 'remove' },
        ],
      });
    });

    test.each([[undefined], [null], ['x'], [[]]])(
      'rejects a body that is not an object (%j)',
      (body) => {
        expect(errorsOf(parsePatchBody(body))).toEqual([{ field: 'body', code: 'invalid-body' }]);
      },
    );

    test.each([[undefined], [-1], [1.5], ['1'], [Number.NaN]])(
      'rejects revision %j',
      (revision) => {
        expect(errorsOf(parse([set('displayName', 'x')], revision))).toContainEqual({
          field: 'revision',
          code: 'invalid-revision',
        });
      },
    );

    test.each([[undefined], ['x'], [{}], [[]]])('rejects changes %j', (changes) => {
      expect(errorsOf(parse(changes))).toContainEqual({
        field: 'changes',
        code: 'invalid-changes',
      });
    });

    test('rejects more than nine changes', () => {
      const changes = Array.from({ length: 10 }, () => set('displayName', 'x'));
      expect(errorsOf(parse(changes))).toContainEqual({
        field: 'changes',
        code: 'too-many-changes',
      });
    });

    test('names the row once the revision is above 0', () => {
      const changes = [set('displayName', 'x')];
      for (const overrideId of [undefined, '', 7]) {
        expect(errorsOf(parsePatchBody({ revision: 2, overrideId, changes }))).toEqual([
          { field: 'overrideId', code: 'invalid-override-id' },
        ]);
      }
      expect(parsePatchBody({ revision: 0, changes })).toMatchObject({ ok: true });
    });

    test('reports revision and changes problems together', () => {
      expect(errorsOf(parsePatchBody({ revision: 'x' })).map((error) => error.code)).toEqual([
        'invalid-revision',
        'invalid-changes',
      ]);
    });

    test('rejects a change that is not an object, names no field, or has a bad op', () => {
      expect(errorsOf(parse([null, 'x', { op: 'set', value: 'a' }]))).toEqual([
        { field: 'changes', code: 'invalid-change' },
        { field: 'changes', code: 'invalid-change' },
        { field: 'changes', code: 'invalid-change' },
      ]);
      expect(errorsOf(parse([{ field: 'displayName', op: 'toggle' }]))).toEqual([
        { field: 'displayName', code: 'invalid-op' },
      ]);
    });

    test('rejects an unknown field, never echoing a prototype key as a known one', () => {
      expect(
        errorsOf(parse([set('nope', 'x'), set('__proto__', 'x'), set('constructor', 'x')])),
      ).toEqual([
        { field: 'nope', code: 'unknown-field' },
        { field: '__proto__', code: 'unknown-field' },
        { field: 'constructor', code: 'unknown-field' },
      ]);
    });

    test('rejects a duplicate field once', () => {
      expect(
        errorsOf(
          parse([set('displayName', 'a'), set('displayName', 'b'), set('displayName', 'c')]),
        ),
      ).toEqual([{ field: 'displayName', code: 'duplicate-field' }]);
    });

    test('rejects a value on remove and a missing value on set', () => {
      expect(
        errorsOf(
          parse([
            { field: 'displayName', op: 'remove', value: 'x' },
            { field: 'displayIcon', op: 'set' },
          ]),
        ),
      ).toEqual([
        { field: 'displayName', code: 'value-on-remove' },
        { field: 'displayIcon', code: 'missing-value' },
      ]);
    });

    test('collects field errors from several changes', () => {
      expect(
        errorsOf(parse([set('displayName', ''), set('dependsOnAction', 'later')])).map(
          (error) => error.code,
        ),
      ).toEqual(['display-name-empty', 'invalid-action']);
    });
  });

  describe('displayName', () => {
    const check = (value: unknown) => validateOverrideValue('displayName', value);

    test('trims and accepts one to 128 code points', () => {
      expect(check('  Sonarr  ')).toEqual({ value: 'Sonarr' });
      expect(check('x'.repeat(128))).toEqual({ value: 'x'.repeat(128) });
      expect(check('😀'.repeat(128))).toEqual({ value: '😀'.repeat(128) });
    });

    test('rejects non-text, blank and over-long names', () => {
      expect(check(5)).toEqual({ code: 'invalid-type' });
      expect(check('   ')).toEqual({ code: 'display-name-empty' });
      expect(check('x'.repeat(129))).toEqual({ code: 'display-name-too-long' });
      expect(check('😀'.repeat(129))).toEqual({ code: 'display-name-too-long' });
    });

    test.each([
      ['a\u0000b'],
      ['a\u001fb'],
      ['a\u007fb'],
      ['a\u009fb'],
      ['a‪b'],
      ['a‮b'],
      ['a⁦b'],
      ['a⁩b'],
      ['<b>'],
      ['a>b'],
    ])('rejects control, bidi and angle-bracket characters (%j)', (value) => {
      expect(check(value)).toEqual({ code: 'display-name-invalid-characters' });
    });
  });

  describe('displayIcon', () => {
    const check = (value: unknown) => validateOverrideValue('displayIcon', value);

    test.each([
      ['sh:sonarr', 'sh:sonarr'],
      ['SH-Sonarr', 'sh:Sonarr'],
      ['hl:home-assistant', 'hl:home-assistant'],
      ['si-docker', 'si:docker'],
      ['Si:a.b_c-1', 'si:a.b_c-1'],
    ])('canonicalizes %s', (input, expected) => {
      expect(check(input)).toEqual({ value: expected });
    });

    test.each([
      [5],
      ['mdi:docker'],
      ['fa-docker'],
      ['https://example.com/icon.png'],
      ['sh:'],
      ['sh:-bad'],
      ['sh:a/b'],
      ['xx:slug'],
      [`sh:${'a'.repeat(129)}`],
      [' sh:sonarr'],
    ])('rejects %j', (value) => {
      expect(check(value)).toEqual({ code: 'invalid-icon' });
    });
  });

  describe('dependsOn', () => {
    const check = (value: unknown) => validateOverrideValue('dependsOn', value);

    test('accepts an empty list and valid names', () => {
      expect(check([])).toEqual({ value: [] });
      expect(check(['db', 'redis.cache', 'a_b-c', 'x'.repeat(255)])).toEqual({
        value: ['db', 'redis.cache', 'a_b-c', 'x'.repeat(255)],
      });
    });

    test('rejects a non-list, too many names, bad names and duplicates', () => {
      expect(check('db')).toEqual({ code: 'invalid-type' });
      expect(check([5])).toEqual({ code: 'invalid-name', entries: ['5'] });
      expect(check(Array.from({ length: 33 }, (_, index) => `c${index}`))).toEqual({
        code: 'too-many-entries',
      });
      expect(check(['db', '-bad', 'a b', 'x'.repeat(256)])).toEqual({
        code: 'invalid-name',
        entries: ['-bad', 'a b', 'x'.repeat(256)],
      });
      expect(check(['db', 'cache', 'db'])).toEqual({ code: 'duplicate-entry', entries: ['db'] });
    });
  });

  describe('dependsOnAction', () => {
    test('accepts update and restart only', () => {
      expect(validateOverrideValue('dependsOnAction', 'update')).toEqual({ value: 'update' });
      expect(validateOverrideValue('dependsOnAction', 'restart')).toEqual({ value: 'restart' });
      expect(validateOverrideValue('dependsOnAction', 'Restart')).toEqual({
        code: 'invalid-action',
      });
      expect(validateOverrideValue('dependsOnAction', 1)).toEqual({ code: 'invalid-action' });
    });
  });

  describe('routing lists', () => {
    const fields = [
      'notificationTriggerInclude',
      'notificationTriggerExclude',
      'actionTriggerInclude',
      'actionTriggerExclude',
      'actionTriggerAuto',
    ];

    test.each(fields)('%s takes an empty list, refs and ref:threshold entries', (field) => {
      expect(validateOverrideValue(field, [])).toEqual({ value: [] });
      expect(
        validateOverrideValue(field, ['docker.local', 'slack.ops:MAJOR', 'a-b_c.d.e:minor-only']),
      ).toEqual({ value: ['docker.local', 'slack.ops:major', 'a-b_c.d.e:minor-only'] });
    });

    test('every supported threshold is accepted', () => {
      for (const threshold of SUPPORTED_THRESHOLDS) {
        expect(validateOverrideValue('actionTriggerInclude', [`docker:${threshold}`])).toEqual({
          value: [`docker:${threshold}`],
        });
      }
    });

    test('rejects a non-list, too many entries, bad refs, bad thresholds and duplicates', () => {
      const check = (value: unknown) => validateOverrideValue('actionTriggerInclude', value);
      expect(check('docker')).toEqual({ code: 'invalid-type' });
      expect(check([5])).toEqual({ code: 'invalid-reference', entries: ['5'] });
      expect(check(Array.from({ length: 33 }, (_, index) => `t${index}`))).toEqual({
        code: 'too-many-entries',
      });
      expect(check(['docker', '', ' x', 'a.b.c.d', 'a:b:c', ':major', 'a..b', '-a'])).toEqual({
        code: 'invalid-reference',
        entries: ['', ' x', 'a.b.c.d', 'a:b:c', ':major', 'a..b', '-a'],
      });
      expect(check(['docker:sometimes', 'slack:'])).toEqual({
        code: 'invalid-threshold',
        entries: ['docker:sometimes', 'slack:'],
      });
      expect(check(['docker', 'DOCKER:all', 'slack', 'slack'])).toEqual({
        code: 'duplicate-entry',
        entries: ['DOCKER:all', 'slack'],
      });
    });

    test('a bare ref and the same ref with an explicit all are one entry', () => {
      expect(validateOverrideValue('actionTriggerAuto', ['docker', 'docker:all'])).toEqual({
        code: 'duplicate-entry',
        entries: ['docker:all'],
      });
    });
  });

  describe('normalizeRoutingEntry', () => {
    test('lowercases the id and defaults the threshold to all', () => {
      expect(normalizeRoutingEntry('Docker.Local')).toBe('docker.local:all');
      expect(normalizeRoutingEntry('Docker.Local:MAJOR')).toBe('docker.local:major');
    });
  });

  test('an unknown field is not a value problem', () => {
    expect(validateOverrideValue('nope', 'x')).toEqual({ code: 'unknown-field' });
  });
});
