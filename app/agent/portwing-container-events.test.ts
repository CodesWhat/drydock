import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetContainer = vi.hoisted(() => vi.fn());
const mockGetOperations = vi.hoisted(() => vi.fn(() => []));
const mockEmit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../store/container.js', () => ({ getContainer: mockGetContainer }));
vi.mock('../store/update-operation.js', () => ({ getOperationsByContainerId: mockGetOperations }));
vi.mock('../event/index.js', () => ({ emitContainerStateAlert: mockEmit }));

import { STATE_ALERT_SETTLE_MS } from '../watchers/providers/docker/container-state-alerts.js';
import { PortwingStateAlerts } from './portwing-container-events.js';

const container = { id: 'c1', name: 'web', watcher: 'docker', agent: 'edge-1' };
const log = { debug: vi.fn() };
const settle = () => vi.advanceTimersByTimeAsync(STATE_ALERT_SETTLE_MS + 10);
const ev = (action: string, extra: Record<string, unknown> = {}) => ({
  containerId: 'c1',
  name: 'web',
  action,
  time: 1,
  ...extra,
});

describe('PortwingStateAlerts', () => {
  let alerts: PortwingStateAlerts;

  beforeEach(() => {
    vi.useFakeTimers();
    mockEmit.mockClear();
    mockGetContainer.mockReset().mockReturnValue(container);
    mockGetOperations.mockReset().mockReturnValue([]);
    alerts = new PortwingStateAlerts('edge-1', log);
  });

  afterEach(() => {
    alerts.dispose();
    vi.useRealTimers();
  });

  test('raises container-exited for a die with a non-zero exit code', async () => {
    alerts.observe(ev('die', { exitCode: 2 }));
    await settle();
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'container-exited',
        containerName: 'web',
        exitCode: 2,
        container,
      }),
    );
  });

  test('die then stop is one container-stopped alert', async () => {
    alerts.observe(ev('die', { exitCode: 137 }));
    alerts.observe(ev('stop'));
    await settle();
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'container-stopped' }));
  });

  test('oom raises container-oom-killed once with the die that follows', async () => {
    alerts.observe(ev('oom', { oomKilled: true }));
    alerts.observe(ev('die', { exitCode: 137 }));
    await settle();
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'container-oom-killed', exitCode: 137 }),
    );
  });

  test('repeated crashes raise a restart loop; start and restart are not counted', async () => {
    for (let i = 0; i < 3; i += 1) {
      alerts.observe(ev('die', { exitCode: 1 }));
      alerts.observe(ev('start'));
      alerts.observe(ev('restart'));
      await settle();
    }
    expect(mockEmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'container-restart-loop', restartCount: 3 }),
    );
  });

  test('a stop with no die raises nothing (die was dropped)', async () => {
    alerts.observe(ev('stop'));
    await settle();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('omits a non-integer exit code', async () => {
    alerts.observe(ev('die', { exitCode: 'x' }));
    await settle();
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ exitCode: undefined }));
  });

  test('ignores containers the store does not hold (unwatched)', async () => {
    mockGetContainer.mockReturnValue(undefined);
    alerts.observe(ev('die', { exitCode: 1 }));
    await settle();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('ignores a container id owned by another agent', async () => {
    mockGetContainer.mockReturnValue({ ...container, agent: 'other' });
    alerts.observe(ev('die', { exitCode: 1 }));
    await settle();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('suppresses changes Drydock initiated', async () => {
    mockGetOperations.mockReturnValue([{ status: 'in-progress' }]);
    alerts.observe(ev('die', { exitCode: 1 }));
    await settle();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test.each([
    ['null', null],
    ['string', 'x'],
    ['missing id', { action: 'die' }],
    ['empty id', { containerId: '', action: 'die' }],
    ['non-string action', { containerId: 'c1', action: 5 }],
    ['unknown action', { containerId: 'c1', action: 'kill' }],
    ['start', { containerId: 'c1', action: 'start' }],
  ])('ignores %s', async (_label, data) => {
    alerts.observe(data);
    await settle();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
