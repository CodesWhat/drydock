// @ts-nocheck
import { fc, test as fcTest } from '@fast-check/vitest';
import { describe, expect, test } from 'vitest';
import Component from './Component.js';

describe('registry/Component fuzz tests', () => {
  test('Component.mask returns undefined for empty string', () => {
    expect(Component.mask('')).toBeUndefined();
  });

  test('validateConfiguration accepts an empty object', () => {
    const component = new Component();
    expect(component.validateConfiguration({})).toEqual({});
  });

  test('Component.mask preserves edges and masks middle characters', () => {
    expect(Component.mask('token-value', 2, '#')).toBe('to#######ue');
  });

  fcTest.prop([fc.string()])('Component.mask never throws on arbitrary strings', (input) => {
    const result = Component.mask(input);
    expect(result === undefined || typeof result === 'string').toBe(true);
  });

  fcTest.prop([fc.string(), fc.integer({ min: 0, max: 20 })])(
    'Component.mask with arbitrary nb parameter never throws',
    (input, nb) => {
      const result = Component.mask(input, nb);
      expect(result === undefined || typeof result === 'string').toBe(true);
    },
  );

  fcTest.prop([
    fc.string(),
    fc.integer({ min: 0, max: 20 }),
    fc.string({ minLength: 1, maxLength: 5 }),
  ])('Component.mask with arbitrary char parameter never throws', (input, nb, char) => {
    const result = Component.mask(input, nb, char);
    expect(result === undefined || typeof result === 'string').toBe(true);
  });

  fcTest.prop([fc.option(fc.string(), { nil: undefined })])(
    'Component.mask handles undefined correctly',
    (input) => {
      const result = Component.mask(input);
      if (input === undefined || input === '') {
        expect(result).toBeUndefined();
      } else {
        expect(typeof result).toBe('string');
      }
    },
  );

  fcTest.prop([fc.anything()])('validateConfiguration handles arbitrary config objects', (config) => {
    const component = new Component();
    try {
      const result = component.validateConfiguration(config);
      expect(typeof result).toBe('object');
    } catch (e) {
      // Joi validation errors are expected for bad input
      expect(e).toBeDefined();
    }
  });

  fcTest.prop([
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.oneof(fc.string({ maxLength: 50 }), fc.integer(), fc.boolean(), fc.constant(null)),
      { minKeys: 0, maxKeys: 5 },
    ),
  ])('validateConfiguration handles dictionary-like configs', (config) => {
    const component = new Component();
    try {
      const result = component.validateConfiguration(config);
      expect(typeof result).toBe('object');
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
});
