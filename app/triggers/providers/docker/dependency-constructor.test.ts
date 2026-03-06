import { describe, expect, test, vi } from 'vitest';
import {
  assertRequiredFunctionDependencies,
  resolveFunctionDependencies,
} from './dependency-constructor.js';

type SampleDependencies = {
  requiredOne: () => string;
  requiredTwo: () => string;
  optionalOne: () => string;
  optionalTwo: () => string;
};

describe('dependency-constructor helper', () => {
  test('assertRequiredFunctionDependencies validates required function dependencies', () => {
    const options = {
      requiredOne: vi.fn(() => 'ok'),
      requiredTwo: vi.fn(() => 'ok'),
    };

    expect(() =>
      assertRequiredFunctionDependencies(
        options,
        ['requiredOne', 'requiredTwo'] as const,
        'SampleExecutor',
      ),
    ).not.toThrow();

    expect(() =>
      assertRequiredFunctionDependencies(
        { requiredOne: vi.fn() },
        ['requiredOne', 'requiredTwo'],
        'SampleExecutor',
      ),
    ).toThrow('SampleExecutor requires dependency "requiredTwo"');

    expect(() =>
      assertRequiredFunctionDependencies(
        { requiredOne: vi.fn() },
        ['requiredOne', 'requiredTwo'],
        'SampleExecutor',
        'context',
      ),
    ).toThrow('SampleExecutor requires dependency "context.requiredTwo"');
  });

  test('resolveFunctionDependencies merges defaults and respects explicit functions', () => {
    const defaults = {
      optionalOne: vi.fn(() => 'default-one'),
      optionalTwo: vi.fn(() => 'default-two'),
    };
    const explicitOptional = vi.fn(() => 'explicit');
    const resolved = resolveFunctionDependencies<SampleDependencies>(
      {
        requiredOne: vi.fn(() => 'r1'),
        requiredTwo: vi.fn(() => 'r2'),
        optionalOne: explicitOptional,
      },
      {
        requiredKeys: ['requiredOne', 'requiredTwo'],
        defaults,
        componentName: 'SampleExecutor',
      },
    );

    expect(resolved.optionalOne).toBe(explicitOptional);
    expect(resolved.optionalTwo).toBe(defaults.optionalTwo);
  });
});
