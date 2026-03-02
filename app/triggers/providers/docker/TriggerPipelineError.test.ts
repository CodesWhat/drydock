import { describe, expect, test } from 'vitest';

import TriggerPipelineError from './TriggerPipelineError.js';

describe('TriggerPipelineError', () => {
  test('constructs with code/message/source and optional cause', () => {
    const cause = new Error('root-cause');
    const err = new TriggerPipelineError('hook-execution-failed', 'hook failed', {
      source: 'HookExecutor',
      cause,
    });

    expect(err.name).toBe('TriggerPipelineError');
    expect(err.code).toBe('hook-execution-failed');
    expect(err.message).toBe('hook failed');
    expect(err.source).toBe('HookExecutor');
    expect(err.cause).toBe(cause);

    const withoutCause = new TriggerPipelineError('x', 'y', { source: 'z' });
    expect('cause' in withoutCause).toBe(false);
  });

  test('isTriggerPipelineError detects only TriggerPipelineError instances with string code', () => {
    expect(TriggerPipelineError.isTriggerPipelineError(undefined)).toBe(false);
    expect(TriggerPipelineError.isTriggerPipelineError({ name: 'TriggerPipelineError' })).toBe(
      false,
    );
    expect(
      TriggerPipelineError.isTriggerPipelineError({ name: 'Error', code: 'hook-execution-failed' }),
    ).toBe(false);

    const err = new TriggerPipelineError('hook-execution-failed', 'hook failed');
    expect(TriggerPipelineError.isTriggerPipelineError(err)).toBe(true);
  });

  test('fromUnknown returns existing TriggerPipelineError instances unchanged', () => {
    const existing = new TriggerPipelineError('security-scan-failed', 'scan failed', {
      source: 'SecurityGate',
    });

    const resolved = TriggerPipelineError.fromUnknown(
      existing,
      'fallback-code',
      'fallback message',
      {
        source: 'Other',
      },
    );

    expect(resolved).toBe(existing);
  });

  test('fromUnknown wraps arbitrary errors and resolves messages from error, message, or code', () => {
    const wrappedFromErrorMessage = TriggerPipelineError.fromUnknown(
      new Error('runner crashed'),
      'hook-execution-failed',
      'fallback message',
      {
        source: 'HookExecutor',
      },
    );
    expect(wrappedFromErrorMessage.code).toBe('hook-execution-failed');
    expect(wrappedFromErrorMessage.message).toBe('runner crashed');
    expect(wrappedFromErrorMessage.source).toBe('HookExecutor');
    expect(wrappedFromErrorMessage.cause).toBeInstanceOf(Error);

    const wrappedFromFallbackMessage = TriggerPipelineError.fromUnknown(
      { reason: 'bad payload' },
      'security-scan-failed',
      'fallback message',
      {
        source: 'SecurityGate',
      },
    );
    expect(wrappedFromFallbackMessage.message).toBe('fallback message');

    const wrappedFromCode = TriggerPipelineError.fromUnknown(
      {},
      'registry-manager-unsupported',
      '   ',
      {
        source: 'RegistryResolver',
      },
    );
    expect(wrappedFromCode.message).toBe('registry-manager-unsupported');
  });
});
