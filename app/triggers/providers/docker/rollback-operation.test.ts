import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockInsertOperation, mockMarkOperationTerminal, mockWarn } = vi.hoisted(() => ({
  mockInsertOperation: vi.fn(),
  mockMarkOperationTerminal: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('../../../store/update-operation.js', () => ({
  insertOperation: mockInsertOperation,
  markOperationTerminal: mockMarkOperationTerminal,
}));
vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ warn: mockWarn }) },
}));

import { finishRollbackOperation, startRollbackOperation } from './rollback-operation.js';

const container = { id: 'c1', name: 'web', watcher: 'local', agent: 'edge' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('startRollbackOperation', () => {
  test('inserts an in-progress rollback operation for the container', () => {
    mockInsertOperation.mockReturnValue({ id: 'op-1' });

    expect(startRollbackOperation(container, { reason: 'manual-rollback', toVersion: '1' })).toBe(
      'op-1',
    );
    expect(mockInsertOperation).toHaveBeenCalledWith({
      kind: 'rollback',
      status: 'in-progress',
      phase: 'rollback-started',
      containerName: 'web',
      containerId: 'c1',
      watcher: 'local',
      agent: 'edge',
      fromVersion: undefined,
      toVersion: '1',
      triggerName: undefined,
      rollbackReason: 'manual-rollback',
    });
  });

  test.each([
    [new Error('db closed'), 'db closed'],
    ['odd failure', 'odd failure'],
  ])('logs and returns undefined when the store throws (%s)', (thrown, text) => {
    mockInsertOperation.mockImplementation(() => {
      throw thrown;
    });

    expect(startRollbackOperation(container, { reason: 'r' })).toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining(text));
  });
});

describe('finishRollbackOperation', () => {
  test('does nothing without an operation id', () => {
    finishRollbackOperation(undefined, {});
    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
  });

  test('closes a restored container as rolled-back, never succeeded', () => {
    finishRollbackOperation('op-1', {});
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith('op-1', {
      status: 'rolled-back',
      phase: 'rolled-back',
    });
  });

  test('closes a failed rollback as failed with the error', () => {
    finishRollbackOperation('op-1', { error: 'boom' });
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith('op-1', {
      status: 'failed',
      phase: 'rollback-failed',
      lastError: 'boom',
    });
  });

  test.each([
    [new Error('db closed'), 'db closed'],
    ['odd failure', 'odd failure'],
  ])('logs a store failure instead of throwing (%s)', (thrown, text) => {
    mockMarkOperationTerminal.mockImplementation(() => {
      throw thrown;
    });

    expect(() => finishRollbackOperation('op-1', {})).not.toThrow();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining(text));
  });
});
