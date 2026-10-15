import { afterEach, describe, expect, test } from 'vitest';
import { isHooksExecutionEnabled, isImageHookLabelsAllowed } from './hook-flags.js';

describe('hook-flags', () => {
  const originalHooksEnabled = process.env.DD_HOOKS_ENABLED;
  const originalAllowImageLabels = process.env.DD_HOOKS_ALLOW_IMAGE_LABELS;

  afterEach(() => {
    for (const [key, value] of [
      ['DD_HOOKS_ENABLED', originalHooksEnabled],
      ['DD_HOOKS_ALLOW_IMAGE_LABELS', originalAllowImageLabels],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test.each([
    ['true', true],
    [' TRUE ', true],
    ['false', false],
    ['1', false],
    ['', false],
    [undefined, false],
  ])('DD_HOOKS_ENABLED=%j is %s', (value, expected) => {
    if (value === undefined) {
      delete process.env.DD_HOOKS_ENABLED;
    } else {
      process.env.DD_HOOKS_ENABLED = value;
    }
    expect(isHooksExecutionEnabled()).toBe(expected);
  });

  test.each([
    ['true', true],
    [' True ', true],
    ['false', false],
    ['yes', false],
    [undefined, false],
  ])('DD_HOOKS_ALLOW_IMAGE_LABELS=%j is %s', (value, expected) => {
    if (value === undefined) {
      delete process.env.DD_HOOKS_ALLOW_IMAGE_LABELS;
    } else {
      process.env.DD_HOOKS_ALLOW_IMAGE_LABELS = value;
    }
    expect(isImageHookLabelsAllowed()).toBe(expected);
  });
});
