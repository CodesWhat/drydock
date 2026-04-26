var { mockGetState, mockGetActiveOperationByContainerId, mockGetActiveOperationByContainerName } =
  vi.hoisted(() => {
    return {
      mockGetState: vi.fn(() => ({ trigger: {} })),
      mockGetActiveOperationByContainerId: vi.fn(() => undefined),
      mockGetActiveOperationByContainerName: vi.fn(() => undefined),
    };
  });

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../store/update-operation.js', () => ({
  getActiveOperationByContainerId: mockGetActiveOperationByContainerId,
  getActiveOperationByContainerName: mockGetActiveOperationByContainerName,
}));

import { enrichContainerLifecyclePayloadWithEligibility } from './sse-container-enrichment.js';

describe('enrichContainerLifecyclePayloadWithEligibility', () => {
  beforeEach(() => {
    mockGetState.mockReturnValue({ trigger: {} });
    mockGetActiveOperationByContainerId.mockReturnValue(undefined);
    mockGetActiveOperationByContainerName.mockReturnValue(undefined);
  });

  describe('malformed payload guard', () => {
    test('returns null unchanged', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(enrichContainerLifecyclePayloadWithEligibility(null as any)).toBeNull();
    });

    test('returns undefined unchanged', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(enrichContainerLifecyclePayloadWithEligibility(undefined as any)).toBeUndefined();
    });

    test('returns payload unchanged when id field is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = { name: 'my-container' } as any;
      expect(enrichContainerLifecyclePayloadWithEligibility(payload)).toBe(payload);
    });

    test('returns payload unchanged when id is not a string', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = { id: 123, name: 'my-container' } as any;
      expect(enrichContainerLifecyclePayloadWithEligibility(payload)).toBe(payload);
    });
  });

  describe('happy path', () => {
    test('attaches updateEligibility with no-update-available when container has no raw update', () => {
      // A minimal container with id+name but no image/result — hasRawTagOrDigestUpdate returns
      // false, so computeUpdateEligibility short-circuits with no-update-available.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = { id: 'c1', name: 'my-container' } as any;
      const result = enrichContainerLifecyclePayloadWithEligibility(payload);

      expect(result).not.toBe(payload);
      expect(result).toMatchObject({
        id: 'c1',
        name: 'my-container',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enriched = result as any;
      expect(enriched.updateEligibility).toBeDefined();
      expect(enriched.updateEligibility.eligible).toBe(false);
      expect(enriched.updateEligibility.blockers).toHaveLength(1);
      expect(enriched.updateEligibility.blockers[0].reason).toBe('no-update-available');
      expect(typeof enriched.updateEligibility.evaluatedAt).toBe('string');
    });

    test('preserves all original payload fields alongside updateEligibility', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = { id: 'c2', name: 'redis', status: 'running', extra: 42 } as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = enrichContainerLifecyclePayloadWithEligibility(payload) as any;

      expect(result.id).toBe('c2');
      expect(result.name).toBe('redis');
      expect(result.status).toBe('running');
      expect(result.extra).toBe(42);
      expect(result.updateEligibility).toBeDefined();
    });
  });

  describe('error resilience', () => {
    test('returns original payload when computeUpdateEligibility throws', async () => {
      // Force registry.getState to throw so buildEligibilityContext propagates an error
      mockGetState.mockImplementation(() => {
        throw new Error('registry exploded');
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = { id: 'c3', name: 'broken' } as any;
      const result = enrichContainerLifecyclePayloadWithEligibility(payload);

      // Must return the original object, not throw
      expect(result).toBe(payload);
    });
  });
});
