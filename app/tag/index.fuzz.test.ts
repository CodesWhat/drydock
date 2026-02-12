// @ts-nocheck
import { fc, test as fcTest } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { diff, isGreater, parse, transform } from './index.js';

describe('tag/index fuzz tests', () => {
  it('parses a standard semver string', () => {
    const result = parse('1.2.3');
    expect(result).toEqual(
      expect.objectContaining({
        major: 1,
        minor: 2,
        patch: 3,
      }),
    );
  });

  it('keeps the original tag when transform formula is invalid', () => {
    expect(transform('invalid-formula', '1.2.3')).toBe('1.2.3');
  });

  it('detects a higher semver and a major diff deterministically', () => {
    expect(isGreater('2.0.0', '1.9.9')).toBe(true);
    expect(diff('1.0.0', '2.0.0')).toBe('major');
  });

  fcTest.prop([fc.string()])('parse never throws on arbitrary strings', (input) => {
    const result = parse(input);
    // Result is either a valid SemVer object or null
    expect(result === null || typeof result === 'object').toBe(true);
  });

  fcTest.prop([fc.string(), fc.string()])(
    'transform never throws on arbitrary formula and tag strings',
    (formula, tag) => {
      const result = transform(formula, tag);
      // Should always return a string (either transformed or original)
      expect(typeof result).toBe('string');
    },
  );

  fcTest.prop([fc.string(), fc.string()])(
    'isGreater never throws on arbitrary version strings',
    (v1, v2) => {
      const result = isGreater(v1, v2);
      expect(typeof result).toBe('boolean');
    },
  );

  fcTest.prop([fc.string(), fc.string()])(
    'diff never throws on arbitrary version strings',
    (v1, v2) => {
      const result = diff(v1, v2);
      // Returns a diff string or null
      expect(result === null || typeof result === 'string').toBe(true);
    },
  );

  fcTest.prop([fc.string({ minLength: 1, maxLength: 20 })])(
    'parse handles version-like strings',
    (input) => {
      const result = parse(input);
      expect(result === null || typeof result === 'object').toBe(true);
    },
  );

  fcTest.prop([
    fc.stringMatching(/^[a-z0-9.+-]{1,30}$/),
    fc.stringMatching(/^[a-z0-9.+-]{1,30}$/),
  ])(
    'isGreater handles semver-like strings',
    (v1, v2) => {
      const result = isGreater(v1, v2);
      expect(typeof result).toBe('boolean');
    },
  );
});
