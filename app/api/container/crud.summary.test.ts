import { describe, expect, test, vi } from 'vitest';

const { mockBuildContainerDashboardSummary } = vi.hoisted(() => ({
  mockBuildContainerDashboardSummary: vi.fn(),
}));

vi.mock('../../util/container-summary.js', () => ({
  buildContainerDashboardSummary: mockBuildContainerDashboardSummary,
}));

vi.mock('./security-overview.js', () => ({
  buildSecurityVulnerabilityOverviewResponse: vi.fn(),
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
  test('getContainerSummary delegates to a single-pass dashboard summary builder', () => {
    const containers = [{ id: 'c1' }, { id: 'c2' }];
    mockBuildContainerDashboardSummary.mockReturnValue({
      status: { total: 2, running: 2, stopped: 0, updatesAvailable: 1 },
      securityIssues: 1,
      hotUpdates: 1,
      matureUpdates: 0,
    });

    const handlers = createHandlers(() => containers);
    const res = createResponse();

    handlers.getContainerSummary({} as never, res as never);

    expect(mockBuildContainerDashboardSummary).toHaveBeenCalledTimes(1);
    expect(mockBuildContainerDashboardSummary).toHaveBeenCalledWith(containers);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      containers: { total: 2, running: 2, stopped: 0, updatesAvailable: 1 },
      security: { issues: 1 },
      hotUpdates: 1,
      matureUpdates: 0,
    });
  });
});
