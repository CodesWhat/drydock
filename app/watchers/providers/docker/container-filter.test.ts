import { describe, expect, test } from 'vitest';
import {
  buildContainerWatchFilter,
  shouldWatchContainer,
  validateContainerFilterPattern,
  validateLabelFilterPattern,
} from './container-filter.js';

const build = (config: Record<string, unknown>) => buildContainerWatchFilter(config as any);

describe('container watch filter', () => {
  test('returns undefined when no filter is configured', () => {
    expect(build({})).toBeUndefined();
    expect(build({ containers: {}, labels: {} })).toBeUndefined();
  });

  test('without filters falls back to dd.watch / watchbydefault', () => {
    expect(shouldWatchContainer('', true, undefined, ['/a'], {})).toBe(true);
    expect(shouldWatchContainer('', false, undefined, ['/a'], {})).toBe(false);
    expect(shouldWatchContainer('true', false, undefined, ['/a'], {})).toBe(true);
    expect(shouldWatchContainer('false', true, undefined, ['/a'], {})).toBe(false);
  });

  test('name include acts as an allowlist and beats watchbydefault=false', () => {
    const filter = build({ containers: { include: '^web-' } });
    expect(shouldWatchContainer('', false, filter, ['/web-1'], {})).toBe(true);
    expect(shouldWatchContainer('', true, filter, ['/db'], {})).toBe(false);
  });

  test('name exclude removes matches and leaves the rest on watchbydefault', () => {
    const filter = build({ containers: { exclude: 'test' } });
    expect(shouldWatchContainer('', true, filter, ['/my-test-db'], {})).toBe(false);
    expect(shouldWatchContainer('', true, filter, ['/prod'], {})).toBe(true);
    expect(shouldWatchContainer('', false, filter, ['/prod'], {})).toBe(false);
  });

  test('exclude wins over include', () => {
    const filter = build({ containers: { include: '^web', exclude: 'canary$' } });
    expect(shouldWatchContainer('', true, filter, ['/web-canary'], {})).toBe(false);
    expect(shouldWatchContainer('', true, filter, ['/web-1'], {})).toBe(true);
  });

  test('dd.watch label overrides the filters in both directions', () => {
    const filter = build({ containers: { include: '^web', exclude: 'canary$' } });
    expect(shouldWatchContainer('true', true, filter, ['/web-canary'], {})).toBe(true);
    expect(shouldWatchContainer('true', false, filter, ['/db'], {})).toBe(true);
    expect(shouldWatchContainer('false', true, filter, ['/web-1'], {})).toBe(false);
  });

  test('matches any of the container names and strips the leading slash', () => {
    const filter = build({ containers: { include: '^app$' } });
    expect(shouldWatchContainer('', true, filter, ['/other', '/app'], {})).toBe(true);
    expect(shouldWatchContainer('', true, filter, [], {})).toBe(false);
    expect(shouldWatchContainer('', true, filter, undefined, {})).toBe(false);
  });

  test('label filters match key=valueRegex and bare keys', () => {
    const filter = build({ labels: { include: 'tier=^(web|api)$' } });
    expect(shouldWatchContainer('', false, filter, ['/a'], { tier: 'web' })).toBe(true);
    expect(shouldWatchContainer('', true, filter, ['/a'], { tier: 'db' })).toBe(false);
    expect(shouldWatchContainer('', true, filter, ['/a'], {})).toBe(false);
    expect(shouldWatchContainer('', true, filter, ['/a'], undefined)).toBe(false);

    const presence = build({ labels: { exclude: 'skip' } });
    expect(shouldWatchContainer('', true, presence, ['/a'], { skip: '' })).toBe(false);
    expect(shouldWatchContainer('', true, presence, ['/a'], { other: '1' })).toBe(true);
  });

  test('a label value containing = keeps everything after the first = as the regex', () => {
    const filter = build({ labels: { include: 'opts=a=b' } });
    expect(shouldWatchContainer('', false, filter, ['/a'], { opts: 'x a=b y' })).toBe(true);
  });

  test('include matches when either the name or the label include matches', () => {
    const filter = build({ containers: { include: '^web' }, labels: { include: 'tier=api' } });
    expect(shouldWatchContainer('', false, filter, ['/web-1'], {})).toBe(true);
    expect(shouldWatchContainer('', false, filter, ['/x'], { tier: 'api' })).toBe(true);
    expect(shouldWatchContainer('', true, filter, ['/x'], { tier: 'db' })).toBe(false);
  });

  test('exclude matches when either the name or the label exclude matches', () => {
    const filter = build({ containers: { exclude: '^tmp' }, labels: { exclude: 'ephemeral' } });
    expect(shouldWatchContainer('', true, filter, ['/tmp-1'], {})).toBe(false);
    expect(shouldWatchContainer('', true, filter, ['/x'], { ephemeral: 'y' })).toBe(false);
    expect(shouldWatchContainer('', true, filter, ['/x'], {})).toBe(true);
  });

  test('uses RE2 semantics, rejecting backreferences and lookaheads', () => {
    expect(() => validateContainerFilterPattern('(a)\\1')).toThrow(/Invalid regular expression/);
    expect(() => validateContainerFilterPattern('(?=a)a')).toThrow(/Invalid regular expression/);
  });

  test('validators reject invalid patterns with a clear message', () => {
    expect(() => validateContainerFilterPattern('(unclosed')).toThrow(
      /Invalid regular expression "\(unclosed"/,
    );
    expect(validateContainerFilterPattern('^ok-.*$')).toBe('^ok-.*$');
    expect(() => validateLabelFilterPattern('=value')).toThrow(/label key/);
    expect(() => validateLabelFilterPattern('key=(bad')).toThrow(/Invalid regular expression/);
    expect(validateLabelFilterPattern('key')).toBe('key');
    expect(validateLabelFilterPattern('key=^v')).toBe('key=^v');
  });
});
