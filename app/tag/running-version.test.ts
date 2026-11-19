import { RE2JS } from 're2js';
import { describe, expect, test } from 'vitest';

import {
  canApplyCeiling,
  getRunningVersion,
  isWithinCeiling,
  normalizeTagCeiling,
  substituteRunningVersionVariables,
} from './running-version.js';

describe('normalizeTagCeiling', () => {
  test.each([
    [undefined, undefined],
    ['', undefined],
    ['  ', undefined],
    ['major', 'major'],
    [' Minor ', 'minor'],
    ['patch', 'invalid'],
    ['1', 'invalid'],
  ])('%j -> %j', (raw, expected) => {
    expect(normalizeTagCeiling(raw as string | undefined)).toBe(expected);
  });
});

describe('getRunningVersion', () => {
  test('reads segments and flavor from a semver tag', () => {
    expect(getRunningVersion('v1.2.3-alpine3.19')).toEqual({
      segments: ['1', '2', '3'],
      flavor: 'alpine3.19',
    });
  });

  test('bare version has an empty flavor', () => {
    expect(getRunningVersion('1.2')).toEqual({ segments: ['1', '2'], flavor: '' });
  });

  test('returns null for non-semver tags', () => {
    expect(getRunningVersion('latest')).toBeNull();
  });
});

describe('canApplyCeiling / isWithinCeiling', () => {
  const running = { segments: ['1', '2', '3'], flavor: '' };

  test('segment requirements', () => {
    expect(canApplyCeiling('major', { segments: ['1'], flavor: '' })).toBe(true);
    expect(canApplyCeiling('minor', { segments: ['1'], flavor: '' })).toBe(false);
    expect(canApplyCeiling('minor', running)).toBe(true);
  });

  test('major ceiling keeps the running major', () => {
    expect(isWithinCeiling('major', running, '1.9.0')).toBe(true);
    expect(isWithinCeiling('major', running, '2.0.0')).toBe(false);
  });

  test('minor ceiling keeps the running major.minor', () => {
    expect(isWithinCeiling('minor', running, '1.2.9')).toBe(true);
    expect(isWithinCeiling('minor', running, '1.3.0')).toBe(false);
    expect(isWithinCeiling('minor', running, '2.2.0')).toBe(false);
  });

  test('leading zeros compare numerically', () => {
    expect(isWithinCeiling('minor', { segments: ['2025', '11'], flavor: '' }, '2025.011.1')).toBe(
      true,
    );
    expect(isWithinCeiling('minor', { segments: ['2025', '0'], flavor: '' }, '2025.00.1')).toBe(
      true,
    );
  });

  test('candidate without the needed segment or numeric shape is rejected', () => {
    expect(isWithinCeiling('minor', running, '1')).toBe(false);
    expect(isWithinCeiling('major', running, 'latest')).toBe(false);
  });
});

describe('substituteRunningVersionVariables', () => {
  const running = { segments: ['1', '2', '3'], flavor: 'alpine3.19' };

  test('pattern without variables is returned unchanged, even without a running version', () => {
    expect(substituteRunningVersionVariables('^1\\.', null)).toEqual({
      ok: true,
      pattern: '^1\\.',
    });
  });

  test('substitutes every variable', () => {
    expect(
      substituteRunningVersionVariables('^${major}\\.${minor}\\.${patch}-${flavor}$', running),
    ).toEqual({ ok: true, pattern: '^1\\.2\\.3-alpine3\\.19$' });
  });

  test('reports each missing variable once', () => {
    expect(
      substituteRunningVersionVariables('${patch}${patch}${flavor}', {
        segments: ['1', '2'],
        flavor: '',
      }),
    ).toEqual({ ok: false, missing: ['patch', 'flavor'] });
  });

  test('a null running version supplies nothing', () => {
    expect(substituteRunningVersionVariables('^${major}', null)).toEqual({
      ok: false,
      missing: ['major'],
    });
  });

  test('unknown variable names are left alone', () => {
    expect(substituteRunningVersionVariables('${other}', running)).toEqual({
      ok: true,
      pattern: '${other}',
    });
  });

  test('escapes regex metacharacters from a malicious running flavor', () => {
    const malicious = { segments: ['1', '2', '3'], flavor: '.*|(x)\\E[a-z]é' };
    const result = substituteRunningVersionVariables('^${flavor}$', malicious);
    expect(result.ok).toBe(true);
    const compiled = RE2JS.compile((result as { pattern: string }).pattern);
    expect(compiled.matcher('.*|(x)\\E[a-z]é').find()).toBe(true);
    expect(compiled.matcher('anything').find()).toBe(false);
    expect(compiled.matcher('x').find()).toBe(false);
  });
});
