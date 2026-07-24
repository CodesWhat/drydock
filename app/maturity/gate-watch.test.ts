import type { Container } from '../model/container.js';
import { maybeEmitMaturityGateCleared } from './gate-watch.js';

const { mockClearMaturityGatePendingSince, mockEmitMaturityGateCleared } = vi.hoisted(() => ({
  mockClearMaturityGatePendingSince: vi.fn(),
  mockEmitMaturityGateCleared: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../store/container.js', () => ({
  clearMaturityGatePendingSince: mockClearMaturityGatePendingSince,
}));

vi.mock('../event/index.js', () => ({
  emitMaturityGateCleared: mockEmitMaturityGateCleared,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    name: 'web',
    displayName: 'web',
    displayIcon: 'mdi:docker',
    status: 'running',
    watcher: 'local',
    image: {
      id: 'image-1',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'arch',
      os: 'os',
    },
    result: { tag: '2.0.0' },
    updateAvailable: true,
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0', semverDiff: 'minor' },
    maturityGatePendingSince: '2026-05-31T09:15:00.000Z',
    ...overrides,
  } as Container;
}

test('returns false and does nothing when the marker is unset', async () => {
  const container = makeContainer({ maturityGatePendingSince: undefined });

  const result = await maybeEmitMaturityGateCleared(container);

  expect(result).toBe(false);
  expect(mockClearMaturityGatePendingSince).not.toHaveBeenCalled();
  expect(mockEmitMaturityGateCleared).not.toHaveBeenCalled();
});

test('clears the marker silently and returns false when the raw update disappeared', async () => {
  const container = makeContainer({
    image: {
      id: 'image-1',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: '2.0.0', semver: true },
      digest: { watch: false },
      architecture: 'arch',
      os: 'os',
    },
    result: { tag: '2.0.0' },
    updateAvailable: false,
  });

  const result = await maybeEmitMaturityGateCleared(container);

  expect(result).toBe(false);
  expect(mockClearMaturityGatePendingSince).toHaveBeenCalledTimes(1);
  expect(mockClearMaturityGatePendingSince).toHaveBeenCalledWith('container-1');
  expect(mockEmitMaturityGateCleared).not.toHaveBeenCalled();
});

test('leaves the marker in place and returns false while still suppressed (e.g. snoozed)', async () => {
  const container = makeContainer({ updateAvailable: false });

  const result = await maybeEmitMaturityGateCleared(container);

  expect(result).toBe(false);
  expect(mockClearMaturityGatePendingSince).not.toHaveBeenCalled();
  expect(mockEmitMaturityGateCleared).not.toHaveBeenCalled();
});

test('clears the marker before emitting and returns true when the gate opened', async () => {
  const callOrder: string[] = [];
  mockClearMaturityGatePendingSince.mockImplementation(() => {
    callOrder.push('clear');
    return true;
  });
  mockEmitMaturityGateCleared.mockImplementation(async () => {
    callOrder.push('emit');
  });
  const container = makeContainer({
    updateAvailable: true,
    updateDetectedAt: '2026-05-31T09:15:00.000Z',
    updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 3 },
  });

  const result = await maybeEmitMaturityGateCleared(container);

  expect(result).toBe(true);
  expect(callOrder).toEqual(['clear', 'emit']);
  expect(mockClearMaturityGatePendingSince).toHaveBeenCalledTimes(1);
  expect(mockClearMaturityGatePendingSince).toHaveBeenCalledWith('container-1');
  expect(mockEmitMaturityGateCleared).toHaveBeenCalledTimes(1);
  expect(mockEmitMaturityGateCleared).toHaveBeenCalledWith(
    expect.objectContaining({
      container: expect.objectContaining({ id: 'container-1' }),
      clearedAt: expect.any(String),
      pendingSince: '2026-05-31T09:15:00.000Z',
      minAgeDays: 3,
      clockSource: 'detectedAt',
    }),
  );
});

test('returns false and does not emit when a concurrent caller already cleared the marker', async () => {
  mockClearMaturityGatePendingSince.mockReturnValue(false);
  const container = makeContainer({
    updateAvailable: true,
    updateDetectedAt: '2026-05-31T09:15:00.000Z',
    updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 3 },
  });

  const result = await maybeEmitMaturityGateCleared(container);

  expect(result).toBe(false);
  expect(mockClearMaturityGatePendingSince).toHaveBeenCalledTimes(1);
  expect(mockClearMaturityGatePendingSince).toHaveBeenCalledWith('container-1');
  expect(mockEmitMaturityGateCleared).not.toHaveBeenCalled();
});

test('defaults minAgeDays to 7 and omits clockSource when the clock does not resolve', async () => {
  mockClearMaturityGatePendingSince.mockReturnValue(true);
  const container = makeContainer({
    updateAvailable: true,
    updateDetectedAt: undefined,
    updatePolicy: { maturityMode: 'mature' },
  });

  const result = await maybeEmitMaturityGateCleared(container);

  expect(result).toBe(true);
  const payload = mockEmitMaturityGateCleared.mock.calls[0][0];
  expect(payload.minAgeDays).toBe(7);
  expect(payload).not.toHaveProperty('clockSource');
});
