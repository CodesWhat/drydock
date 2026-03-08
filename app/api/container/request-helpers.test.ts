import { describe, expect, test } from 'vitest';
import {
  getPathParamValue,
  normalizeLimitOffsetPagination,
  parseBooleanQueryParam,
  parseIntegerQueryParam,
} from './request-helpers.js';

describe('api/container/request-helpers', () => {
  describe('getPathParamValue', () => {
    test('returns string path params as-is', () => {
      expect(getPathParamValue('abc')).toBe('abc');
    });

    test('returns first value for array path params', () => {
      expect(getPathParamValue(['abc', 'def'])).toBe('abc');
    });

    test('returns first array value even when empty and later values exist', () => {
      expect(getPathParamValue(['', 'fallback'])).toBe('');
    });

    test('returns empty string for missing values', () => {
      expect(getPathParamValue(undefined)).toBe('');
      expect(getPathParamValue([])).toBe('');
    });
  });

  describe('parseIntegerQueryParam', () => {
    test('parses a string integer value', () => {
      expect(parseIntegerQueryParam('42', 5)).toBe(42);
    });

    test('parses the first value when query param is an array', () => {
      expect(parseIntegerQueryParam(['7', '9'], 5)).toBe(7);
    });

    test('returns fallback when query param is invalid or not a string', () => {
      expect(parseIntegerQueryParam('nope', 5)).toBe(5);
      expect(parseIntegerQueryParam(undefined, 5)).toBe(5);
      expect(parseIntegerQueryParam(10, 5)).toBe(5);
    });
  });

  describe('parseBooleanQueryParam', () => {
    test('parses true and false string values', () => {
      expect(parseBooleanQueryParam('true', false)).toBe(true);
      expect(parseBooleanQueryParam('false', true)).toBe(false);
    });

    test('parses the first value when query param is an array', () => {
      expect(parseBooleanQueryParam(['true', 'false'], false)).toBe(true);
    });

    test('returns fallback when query param is invalid or not a string', () => {
      expect(parseBooleanQueryParam('yes', false)).toBe(false);
      expect(parseBooleanQueryParam(undefined, true)).toBe(true);
      expect(parseBooleanQueryParam(1, true)).toBe(true);
    });
  });

  describe('normalizeLimitOffsetPagination', () => {
    test('normalizes and clamps limit/offset values', () => {
      expect(
        normalizeLimitOffsetPagination(
          {
            limit: ['999', '1'],
            offset: '-5',
          },
          { maxLimit: 200 },
        ),
      ).toEqual({ limit: 200, offset: 0 });
    });

    test('returns defaults for non-object query input', () => {
      expect(normalizeLimitOffsetPagination('' as any, { maxLimit: 200 })).toEqual({
        limit: 0,
        offset: 0,
      });
    });
  });
});
