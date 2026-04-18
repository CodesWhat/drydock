import { describe, expect, test, vi } from 'vitest';

const { mockGetContainerStatusSummary, mockGetSecurityIssueCount } = vi.hoisted(() => ({
  mockGetContainerStatusSummary: vi.fn(),
  mockGetSecurityIssueCount: vi.fn(),
}));

vi.mock('../../util/container-summary.js', () => ({
  getContainerStatusSummary: mockGetContainerStatusSummary,
}));

vi.mock('./security-overview.js', () => ({
  buildSecurityVulnerabilityOverviewResponse: vi.fn(),
  getSecurityIssueCount: mockGetSecurityIssueCount,
}));

import { createCrudHandlers } from './crud.js';

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

function createHandlers(getContainersFromStore: () => unknown) {
  return createCrudHandlers({
    storeApi: {
      getContainersFromStore: getContainersFromStore as never,
      getContainerCountFromStore: vi.fn(() => 0),
      storeContainer: {
        getContainer: vi.fn(),
        deleteContainer: vi.fn(),
      },
      updateOperationStore: {
        getOperationsByContainerName: vi.fn(() => []),
        getInProgressOperationByContainerName: vi.fn(),
        getInProgressOperationByContainerId: vi.fn(),
        getActiveOperationByContainerName: vi.fn(),
        getActiveOperationByContainerId: vi.fn(),
      },
      getContainerRaw: vi.fn(),
    },
    agentApi: {
      getServerConfiguration: vi.fn(() => ({ feature: { delete: true } })),
      getAgent: vi.fn(),
      getWatchers: vi.fn(() => ({})),
    },
    errorApi: {
      getErrorMessage: vi.fn(() => 'error'),
      getErrorStatusCode: vi.fn(),
    },
    securityApi: {
      redactContainerRuntimeEnv: vi.fn((container) => container),
      redactContainersRuntimeEnv: vi.fn((containers) => containers),
    },
  });
}

describe('api/container/crud summary partitioning', () => {
  test('getContainerSummary computes hot and mature update counters with a single reduce-capable collection', () => {
    const items = [
      { id: 'c1', updateAvailable: true, updateMaturityLevel: 'hot' },
      { id: 'c2', updateAvailable: true, updateMaturityLevel: 'mature' },
      { id: 'c3', updateAvailable: true, updateMaturityLevel: 'established' },
      { id: 'c4', updateAvailable: false, updateMaturityLevel: 'hot' },
    ];
    const containers = {
      length: items.length,
      reduce: items.reduce.bind(items),
    };

    mockGetContainerStatusSummary.mockReturnValue({
      total: 4,
      running: 4,
      stopped: 0,
      updatesAvailable: 3,
    });
    mockGetSecurityIssueCount.mockReturnValue(0);

    const handlers = createHandlers(() => containers);
    const res = createResponse();

    handlers.getContainerSummary({} as never, res as never);

    expect(mockGetContainerStatusSummary).toHaveBeenCalledWith(containers);
    expect(mockGetSecurityIssueCount).toHaveBeenCalledWith(containers);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      containers: {
        total: 4,
        running: 4,
        stopped: 0,
        updatesAvailable: 3,
      },
      security: { issues: 0 },
      hotUpdates: 1,
      matureUpdates: 2,
    });
  });
});
