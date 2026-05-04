const { mockRouter, mockGetContainers, mockRegistryState, mockAggregator, mockHandlers } =
  vi.hoisted(() => ({
    mockRouter: { use: vi.fn(), get: vi.fn() },
    mockGetContainers: vi.fn(() => []),
    mockRegistryState: vi.fn(() => ({ watcher: {} })),
    mockAggregator: { start: vi.fn(), stop: vi.fn(), getCurrent: vi.fn(), subscribe: vi.fn() },
    mockHandlers: {
      getStatsSummary: vi.fn(),
      streamStatsSummary: vi.fn(),
    },
  }));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container.js', () => ({
  getContainers: mockGetContainers,
}));

vi.mock('../registry/index.js', () => ({
  getState: mockRegistryState,
}));

vi.mock('../stats/aggregator.js', () => ({
  createContainerStatsAggregator: vi.fn(() => mockAggregator),
}));

vi.mock('./container/stats.js', () => ({
  createSummaryStatsHandlers: vi.fn(() => mockHandlers),
}));

import { createContainerStatsAggregator } from '../stats/aggregator.js';
import { createSummaryStatsHandlers } from './container/stats.js';
import * as statsRouter from './stats.js';

describe('Stats Router', () => {
  test('starts the aggregator at module load', () => {
    expect(mockAggregator.start).toHaveBeenCalled();
  });

  test('passes store + registry accessors to the aggregator factory', () => {
    expect(createContainerStatsAggregator).toHaveBeenCalledWith({
      getContainers: expect.any(Function),
      getWatchers: expect.any(Function),
    });
    const args = vi.mocked(createContainerStatsAggregator).mock.calls[0]?.[0];
    args?.getContainers();
    expect(mockGetContainers).toHaveBeenCalled();
    args?.getWatchers();
    expect(mockRegistryState).toHaveBeenCalled();
  });

  test('getWatchers falls back to empty object when registry state has no watcher field', () => {
    mockRegistryState.mockReturnValueOnce({} as unknown as { watcher: Record<string, unknown> });
    const args = vi.mocked(createContainerStatsAggregator).mock.calls[0]?.[0];
    expect(args?.getWatchers()).toEqual({});
  });

  test('builds summary handlers with the aggregator', () => {
    expect(createSummaryStatsHandlers).toHaveBeenCalledWith({ aggregator: mockAggregator });
  });

  test('init() registers /summary and /summary/stream and applies nocache', () => {
    const router = statsRouter.init();
    expect(router).toBe(mockRouter);
    expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
    expect(mockRouter.get).toHaveBeenCalledWith('/summary', mockHandlers.getStatsSummary);
    expect(mockRouter.get).toHaveBeenCalledWith('/summary/stream', mockHandlers.streamStatsSummary);
  });
});
