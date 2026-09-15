import { canonicalConfigurationJSON, diffComponentConfigurations } from './reconcile.js';

describe('diffComponentConfigurations', () => {
  test('classifies an id present in both maps with identical JSON as unchanged', () => {
    const current = new Map([['docker.local', '{"a":1}']]);
    const desired = new Map([['docker.local', '{"a":1}']]);
    expect(diffComponentConfigurations(current, desired)).toStrictEqual({
      add: [],
      change: [],
      remove: [],
      unchanged: ['docker.local'],
    });
  });

  test('classifies an id present in both maps with different JSON as changed', () => {
    const current = new Map([['slack.myslack', '{"channel":"#a"}']]);
    const desired = new Map([['slack.myslack', '{"channel":"#b"}']]);
    expect(diffComponentConfigurations(current, desired)).toStrictEqual({
      add: [],
      change: ['slack.myslack'],
      remove: [],
      unchanged: [],
    });
  });

  test('classifies an id only in desired as added', () => {
    const current = new Map<string, string>();
    const desired = new Map([['ghcr.private', '{}']]);
    expect(diffComponentConfigurations(current, desired)).toStrictEqual({
      add: ['ghcr.private'],
      change: [],
      remove: [],
      unchanged: [],
    });
  });

  test('classifies an id only in current as removed', () => {
    const current = new Map([['ghcr.private', '{}']]);
    const desired = new Map<string, string>();
    expect(diffComponentConfigurations(current, desired)).toStrictEqual({
      add: [],
      change: [],
      remove: ['ghcr.private'],
      unchanged: [],
    });
  });

  test('handles an empty current and an empty desired map', () => {
    expect(diffComponentConfigurations(new Map(), new Map())).toStrictEqual({
      add: [],
      change: [],
      remove: [],
      unchanged: [],
    });
  });

  test('sorts every returned array regardless of Map insertion order', () => {
    const current = new Map([
      ['zzz.trigger', '{}'],
      ['aaa.trigger', '{}'],
    ]);
    const desired = new Map([
      ['zzz.trigger', '{"x":1}'],
      ['aaa.trigger', '{"x":1}'],
      ['bbb.watcher', '{}'],
    ]);
    expect(diffComponentConfigurations(current, desired)).toStrictEqual({
      add: ['bbb.watcher'],
      change: ['aaa.trigger', 'zzz.trigger'],
      remove: [],
      unchanged: [],
    });
  });

  test('combines add, change, remove and unchanged in a single diff', () => {
    const current = new Map([
      ['docker.local', '{"socket":"a"}'],
      ['slack.old', '{}'],
      ['discord.same', '{"url":"x"}'],
    ]);
    const desired = new Map([
      ['docker.local', '{"socket":"b"}'],
      ['discord.same', '{"url":"x"}'],
      ['telegram.new', '{}'],
    ]);
    expect(diffComponentConfigurations(current, desired)).toStrictEqual({
      add: ['telegram.new'],
      change: ['docker.local'],
      remove: ['slack.old'],
      unchanged: ['discord.same'],
    });
  });
});

describe('canonicalConfigurationJSON', () => {
  test('produces the same string for the same keys in a different order', () => {
    expect(canonicalConfigurationJSON({ b: 1, a: 2 })).toEqual(
      canonicalConfigurationJSON({ a: 2, b: 1 }),
    );
  });

  test('produces different strings for different values', () => {
    expect(canonicalConfigurationJSON({ a: 1 })).not.toEqual(canonicalConfigurationJSON({ a: 2 }));
  });

  test('sorts keys recursively in nested objects', () => {
    expect(canonicalConfigurationJSON({ outer: { z: 1, a: 2 } })).toEqual(
      canonicalConfigurationJSON({ outer: { a: 2, z: 1 } }),
    );
  });

  test('preserves array order (arrays are not sorted)', () => {
    expect(canonicalConfigurationJSON([1, 2, 3])).toEqual('[1,2,3]');
    expect(canonicalConfigurationJSON([3, 2, 1])).toEqual('[3,2,1]');
  });

  test('canonicalizes objects nested inside arrays', () => {
    expect(canonicalConfigurationJSON([{ b: 1, a: 2 }])).toEqual('[{"a":2,"b":1}]');
  });

  test('passes through primitives and null unchanged', () => {
    expect(canonicalConfigurationJSON('x')).toEqual('"x"');
    expect(canonicalConfigurationJSON(1)).toEqual('1');
    expect(canonicalConfigurationJSON(true)).toEqual('true');
    expect(canonicalConfigurationJSON(null)).toEqual('null');
  });

  test('handles an empty object and an empty array', () => {
    expect(canonicalConfigurationJSON({})).toEqual('{}');
    expect(canonicalConfigurationJSON([])).toEqual('[]');
  });
});
