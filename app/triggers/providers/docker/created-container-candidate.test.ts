import { describe, expect, test, vi } from 'vitest';
import {
  attachCreatedContainerCandidate,
  cleanupCreatedContainerCandidate,
  getCreatedContainerCandidate,
} from './created-container-candidate.js';

function createLog() {
  return { warn: vi.fn() };
}

describe('created-container-candidate', () => {
  describe('attachCreatedContainerCandidate / getCreatedContainerCandidate', () => {
    test('attaches the candidate onto an object error and reads it back', () => {
      const error = new Error('connect failed');
      const candidate = { id: 'orphan' };

      attachCreatedContainerCandidate(error, candidate);

      expect(getCreatedContainerCandidate(error)).toBe(candidate);
    });

    test('does not attach when there is no candidate', () => {
      const error = new Error('boom');

      attachCreatedContainerCandidate(error, undefined);

      expect(getCreatedContainerCandidate(error)).toBeUndefined();
    });

    test('does not attach when the error is not an object', () => {
      // Should not throw when given a non-object error (e.g. a thrown string).
      expect(() => attachCreatedContainerCandidate('boom', { id: 'orphan' })).not.toThrow();
    });

    test('does not attach when error is null', () => {
      expect(() => attachCreatedContainerCandidate(null, { id: 'orphan' })).not.toThrow();
    });

    test('getCreatedContainerCandidate returns undefined for non-object errors', () => {
      expect(getCreatedContainerCandidate('boom')).toBeUndefined();
      expect(getCreatedContainerCandidate(null)).toBeUndefined();
      expect(getCreatedContainerCandidate(undefined)).toBeUndefined();
    });

    test('uses a field name distinct from the compose channel', () => {
      const error = new Error('connect failed');
      const candidate = { id: 'orphan' };

      attachCreatedContainerCandidate(error, candidate);

      expect((error as unknown as Record<string, unknown>).createdContainerCandidate).toBe(
        candidate,
      );
      expect(
        (error as unknown as Record<string, unknown>).composeCreatedContainerCandidate,
      ).toBeUndefined();
    });
  });

  describe('cleanupCreatedContainerCandidate', () => {
    test('does nothing when candidate is missing', async () => {
      await expect(
        cleanupCreatedContainerCandidate(undefined, 'web', createLog()),
      ).resolves.toBeUndefined();
    });

    test('does nothing when candidate is not an object', async () => {
      await expect(
        cleanupCreatedContainerCandidate('not-an-object', 'web', createLog()),
      ).resolves.toBeUndefined();
    });

    test('stops and force-removes the candidate', async () => {
      const stop = vi.fn().mockResolvedValue(undefined);
      const remove = vi.fn().mockResolvedValue(undefined);
      const log = createLog();

      await cleanupCreatedContainerCandidate({ stop, remove }, 'web', log);

      expect(stop).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith({ force: true });
      expect(log.warn).not.toHaveBeenCalled();
    });

    test('warns but continues when stop fails', async () => {
      const stop = vi.fn().mockRejectedValue(new Error('stop exploded'));
      const remove = vi.fn().mockResolvedValue(undefined);
      const log = createLog();

      await cleanupCreatedContainerCandidate({ stop, remove }, 'web', log);

      expect(remove).toHaveBeenCalledWith({ force: true });
      expect(log.warn).toHaveBeenCalledWith(
        'Unable to stop orphaned replacement container web (stop exploded)',
      );
    });

    test('warns but does not throw when remove fails', async () => {
      const stop = vi.fn().mockResolvedValue(undefined);
      const remove = vi.fn().mockRejectedValue('remove exploded as string');
      const log = createLog();

      await cleanupCreatedContainerCandidate({ stop, remove }, 'web', log);

      expect(log.warn).toHaveBeenCalledWith(
        'Unable to remove orphaned replacement container web (remove exploded as string)',
      );
    });

    test('tolerates a candidate with no stop/remove functions', async () => {
      const log = createLog();

      await expect(cleanupCreatedContainerCandidate({}, 'web', log)).resolves.toBeUndefined();
      expect(log.warn).not.toHaveBeenCalled();
    });
  });
});
