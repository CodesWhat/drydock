import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetContainer, mockGetContainers, mockUpdateContainer, mockWarn } = vi.hoisted(() => ({
  mockGetContainer: vi.fn(),
  mockGetContainers: vi.fn(),
  mockUpdateContainer: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('../../../store/container.js', () => ({
  getContainer: mockGetContainer,
  getContainers: mockGetContainers,
  updateContainer: mockUpdateContainer,
}));
vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ warn: mockWarn, info: vi.fn() }) },
}));

import { getRollbackCandidateTarget, recordUpdateRollback } from './rollback-state.js';

const reference = { id: 'old-id', name: 'web', watcher: 'local' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getRollbackCandidateTarget', () => {
  test('prefers the digest, then the tag, then the fallback', () => {
    expect(getRollbackCandidateTarget({ result: { digest: 'sha256:a', tag: '2' } }, '3')).toBe(
      'sha256:a',
    );
    expect(getRollbackCandidateTarget({ result: { tag: '2' } }, '3')).toBe('2');
    expect(getRollbackCandidateTarget({}, '3')).toBe('3');
    expect(getRollbackCandidateTarget({}, undefined)).toBe('');
  });
});

describe('recordUpdateRollback', () => {
  test('writes updateRollback onto the container found by id', () => {
    mockGetContainer.mockReturnValue({ id: 'old-id', name: 'web' });

    recordUpdateRollback(reference, {
      targetDigest: 'sha256:bad',
      reason: 'manual-rollback',
    });

    expect(mockUpdateContainer).toHaveBeenCalledWith({
      id: 'old-id',
      name: 'web',
      updateRollback: {
        recordedAt: expect.any(String),
        targetDigest: 'sha256:bad',
        reason: 'manual-rollback',
        lastError: '',
      },
    });
  });

  test('falls back to name and watcher when the id is gone, honouring the agent', () => {
    mockGetContainer.mockReturnValue(undefined);
    mockGetContainers.mockReturnValue([
      { id: 'other-agent', name: 'web', agent: 'edge' },
      { id: 'new-id', name: 'web' },
    ]);

    recordUpdateRollback(
      { ...reference, id: undefined },
      { targetDigest: '2.0.0', reason: 'liveness-failure', lastError: 'boom' },
    );

    expect(mockGetContainers).toHaveBeenCalledWith({ name: 'web', watcher: 'local' });
    expect(mockUpdateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-id',
        updateRollback: expect.objectContaining({ lastError: 'boom' }),
      }),
    );
  });

  test('warns and writes nothing when the container is not in the store', () => {
    mockGetContainer.mockReturnValue(undefined);
    mockGetContainers.mockReturnValue([]);

    recordUpdateRollback(reference, { targetDigest: 'x', reason: 'r' });

    expect(mockUpdateContainer).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('container not found'));
  });

  test.each([
    [new Error('db locked'), 'db locked'],
    ['plain failure', 'plain failure'],
  ])('logs a store failure instead of throwing (%s)', (thrown, text) => {
    mockGetContainer.mockReturnValue({ id: 'old-id' });
    mockUpdateContainer.mockImplementation(() => {
      throw thrown;
    });

    expect(() => recordUpdateRollback(reference, { targetDigest: 'x', reason: 'r' })).not.toThrow();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining(text));
  });
});
