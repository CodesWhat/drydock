import {
  endDigestCachePollCycleForRegistries,
  startDigestCachePollCycleForRegistries,
} from './digest-cache-lifecycle.js';

vi.mock('../../../registry/index.js', () => ({
  getState: vi.fn(),
}));

import * as registry from '../../../registry/index.js';

const mockGetState = vi.mocked(registry.getState);

describe('digest-cache-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startDigestCachePollCycleForRegistries', () => {
    test('calls startDigestCachePollCycle on each registry that supports it', () => {
      const startA = vi.fn();
      const startB = vi.fn();
      mockGetState.mockReturnValue({
        registry: {
          a: { startDigestCachePollCycle: startA },
          b: { startDigestCachePollCycle: startB },
        },
      } as never);

      startDigestCachePollCycleForRegistries();

      expect(startA).toHaveBeenCalledOnce();
      expect(startB).toHaveBeenCalledOnce();
    });

    test('skips registries without startDigestCachePollCycle', () => {
      mockGetState.mockReturnValue({
        registry: {
          a: { startDigestCachePollCycle: vi.fn() },
          b: {},
        },
      } as never);

      expect(() => startDigestCachePollCycleForRegistries()).not.toThrow();
    });

    test('handles empty registry map', () => {
      mockGetState.mockReturnValue({ registry: {} } as never);

      expect(() => startDigestCachePollCycleForRegistries()).not.toThrow();
    });
  });

  describe('endDigestCachePollCycleForRegistries', () => {
    test('calls endDigestCachePollCycle on each registry that supports it', () => {
      const endA = vi.fn();
      const endB = vi.fn();
      mockGetState.mockReturnValue({
        registry: {
          a: { endDigestCachePollCycle: endA },
          b: { endDigestCachePollCycle: endB },
        },
      } as never);

      endDigestCachePollCycleForRegistries();

      expect(endA).toHaveBeenCalledOnce();
      expect(endB).toHaveBeenCalledOnce();
    });

    test('skips registries without endDigestCachePollCycle', () => {
      mockGetState.mockReturnValue({
        registry: {
          a: { endDigestCachePollCycle: vi.fn() },
          b: {},
        },
      } as never);

      expect(() => endDigestCachePollCycleForRegistries()).not.toThrow();
    });

    test('handles empty registry map', () => {
      mockGetState.mockReturnValue({ registry: {} } as never);

      expect(() => endDigestCachePollCycleForRegistries()).not.toThrow();
    });
  });
});
