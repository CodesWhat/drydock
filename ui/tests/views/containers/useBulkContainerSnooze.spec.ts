import { ref } from 'vue';
import { updateContainerPolicy } from '@/services/container';
import { useBulkContainerSnooze } from '@/views/containers/useBulkContainerSnooze';

vi.mock('@/services/container', () => ({ updateContainerPolicy: vi.fn() }));

const first = { id: 'local-1', identityKey: '::local::web', name: 'web', agent: undefined };
const second = { id: 'edge-1', identityKey: 'edge::local::web', name: 'web', agent: 'edge' };

function harness() {
  const enabled = ref(true);
  const loadContainers = vi.fn().mockResolvedValue(undefined);
  const core = useBulkContainerSnooze({ containerActionsEnabled: enabled, loadContainers });
  return { ...core, enabled, loadContainers };
}

describe('useBulkContainerSnooze', () => {
  beforeEach(() => {
    vi.mocked(updateContainerPolicy).mockReset().mockResolvedValue({});
  });

  it('snoozes each explicit id once and reloads once after the whole batch', async () => {
    const core = harness();
    const result = await core.snooze([first, second, first], { days: 7 });

    expect(updateContainerPolicy).toHaveBeenNthCalledWith(1, first.id, 'snooze', { days: 7 });
    expect(updateContainerPolicy).toHaveBeenNthCalledWith(2, second.id, 'snooze', { days: 7 });
    expect(updateContainerPolicy).toHaveBeenCalledTimes(2);
    expect(core.loadContainers).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'completed', succeeded: [first, second], failed: [] });
    expect(core.inProgress.value).toBe(false);
  });

  it('continues after a failed target and preserves same-name target identities', async () => {
    const failure = new Error('Container not found');
    vi.mocked(updateContainerPolicy).mockRejectedValueOnce(failure);
    const core = harness();

    expect(await core.snooze([first, second], { days: 1 })).toEqual({
      status: 'completed',
      succeeded: [second],
      failed: [{ target: first, error: failure }],
    });
    expect(core.loadContainers).toHaveBeenCalledTimes(1);
  });

  it('keeps reload failure separate from successful policy writes', async () => {
    const core = harness();
    const error = new Error('Refresh failed');
    core.loadContainers.mockRejectedValueOnce(error);

    expect(await core.snooze([first], { days: 1 })).toEqual({
      status: 'completed',
      succeeded: [first],
      failed: [],
      reloadFailure: { error },
    });
    expect(core.inProgress.value).toBe(false);
  });

  it('reloads once even when all writes fail', async () => {
    const error = new Error('Forbidden');
    vi.mocked(updateContainerPolicy).mockRejectedValue(error);
    const core = harness();

    expect(await core.snooze([first, second], { days: 1 })).toEqual({
      status: 'completed',
      succeeded: [],
      failed: [
        { target: first, error },
        { target: second, error },
      ],
    });
    expect(core.loadContainers).toHaveBeenCalledTimes(1);
  });

  it('snapshots target identities and duration before yielding', async () => {
    let finish!: () => void;
    vi.mocked(updateContainerPolicy).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        }),
    );
    const core = harness();
    const targets = [{ ...first }, { ...second }];
    const duration = { days: 7 };
    const pending = core.snooze(targets, duration);
    targets[1]!.id = 'unconfirmed';
    targets[1]!.name = 'changed';
    targets.push({
      id: 'hidden',
      identityKey: '::local::hidden',
      name: 'hidden',
      agent: undefined,
    });
    duration.days = 30;
    finish();

    expect(await pending).toEqual({ status: 'completed', succeeded: [first, second], failed: [] });
    expect(updateContainerPolicy).toHaveBeenLastCalledWith(second.id, 'snooze', { days: 7 });
    expect(updateContainerPolicy).toHaveBeenCalledTimes(2);
  });

  it('rejects a repeated submission until final reload completes', async () => {
    const core = harness();
    let finish!: () => void;
    core.loadContainers.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = core.snooze([first], { days: 1 });
    await vi.waitFor(() => expect(core.loadContainers).toHaveBeenCalledTimes(1));

    expect(core.inProgress.value).toBe(true);
    expect(await core.snooze([second], { days: 7 })).toEqual({ status: 'busy' });
    expect(updateContainerPolicy).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    expect(core.inProgress.value).toBe(false);
    await core.snooze([second], { days: 7 });
    expect(updateContainerPolicy).toHaveBeenCalledTimes(2);
  });

  it('does not write or reload when actions are disabled', async () => {
    const core = harness();
    core.enabled.value = false;
    expect(await core.snooze([first], { days: 1 })).toEqual({ status: 'disabled' });
    expect(updateContainerPolicy).not.toHaveBeenCalled();
    expect(core.loadContainers).not.toHaveBeenCalled();
  });

  it('treats an empty target list as an empty completed batch without reloading', async () => {
    const core = harness();
    expect(await core.snooze([], { days: 1 })).toEqual({
      status: 'completed',
      succeeded: [],
      failed: [],
    });
    expect(updateContainerPolicy).not.toHaveBeenCalled();
    expect(core.loadContainers).not.toHaveBeenCalled();
  });

  it.each([0, -1, 366, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid duration %s before writes',
    async (days) => {
      const core = harness();
      expect(await core.snooze([first], { days })).toEqual({ status: 'invalid', field: 'days' });
      expect(updateContainerPolicy).not.toHaveBeenCalled();
      expect(core.loadContainers).not.toHaveBeenCalled();
    },
  );

  it.each([0.5, 365])('preserves supported duration %s', async (days) => {
    await harness().snooze([first], { days });
    expect(updateContainerPolicy).toHaveBeenCalledWith(first.id, 'snooze', { days });
  });

  it('uses the existing local end-of-day conversion for a date', async () => {
    await harness().snooze([first, second], { date: '2099-04-14' });
    expect(updateContainerPolicy).toHaveBeenNthCalledWith(1, first.id, 'snooze', {
      snoozeUntil: new Date('2099-04-14T23:59:59').toISOString(),
    });
    expect(updateContainerPolicy).toHaveBeenNthCalledWith(2, second.id, 'snooze', {
      snoozeUntil: new Date('2099-04-14T23:59:59').toISOString(),
    });
  });

  it.each(['', '2099/04/14', '2099-13-40'])(
    'rejects invalid date %s before writes',
    async (date) => {
      const core = harness();
      expect(await core.snooze([first], { date })).toEqual({ status: 'invalid', field: 'date' });
      expect(updateContainerPolicy).not.toHaveBeenCalled();
      expect(core.loadContainers).not.toHaveBeenCalled();
    },
  );
});
