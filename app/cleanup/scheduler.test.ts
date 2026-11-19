const { mockSchedule, mockPolicies, mockResolve, mockRun, mockBusy, mockExecute } = vi.hoisted(
  () => ({
    mockSchedule: vi.fn(),
    mockPolicies: vi.fn(),
    mockResolve: vi.fn(),
    mockRun: vi.fn(),
    mockBusy: vi.fn(),
    mockExecute: vi.fn(),
  }),
);

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));
vi.mock('node-cron', () => ({ default: { schedule: mockSchedule } }));
vi.mock('./config.js', () => ({ getCleanupPolicies: mockPolicies }));
vi.mock('./engine.js', () => ({ executeCleanup: mockExecute }));
vi.mock('./run.js', () => ({
  isHostBusy: mockBusy,
  resolvePolicyHosts: mockResolve,
  runCleanupOnHost: mockRun,
}));

import { makeApi, makeHost, makePolicy } from './cleanup.test.helpers.js';
import { getCleanupPolicyList, init, shutdown } from './scheduler.js';

const host = makeHost(makeApi().api);
const resolved = { id: host.id, host };

function jobFor(expression: string): () => void {
  const call = mockSchedule.mock.calls.find((entry) => entry[0] === expression);
  return call?.[1] as () => void;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('cleanup scheduler', () => {
  const stop = vi.fn();

  beforeEach(() => {
    shutdown();
    stop.mockReset();
    mockSchedule.mockReset().mockReturnValue({ stop });
    mockPolicies.mockReset();
    mockResolve.mockReset().mockReturnValue([resolved, { id: 'edge.docker.x' }]);
    mockRun.mockReset().mockResolvedValue(undefined);
    mockBusy.mockReset().mockReturnValue(false);
    mockExecute.mockReset();
  });

  afterAll(() => shutdown());

  test('schedules nothing when no policy is configured', () => {
    mockPolicies.mockReturnValue([]);
    init();
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(getCleanupPolicyList()).toEqual([]);
  });

  test('a cron policy runs on every resolved host on schedule', async () => {
    const policy = makePolicy({ cron: '0 3 * * *' });
    mockPolicies.mockReturnValue([policy]);
    init();
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    jobFor('0 3 * * *')();
    await flush();
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenCalledWith(resolved, policy, 'schedule');
    expect(getCleanupPolicyList()).toEqual([policy]);
  });

  test('a threshold-only policy schedules the check cron and runs only above the threshold', async () => {
    const policy = makePolicy({ cron: '', thresholdBytes: 100, checkCron: '*/10 * * * *' });
    mockPolicies.mockReturnValue([policy]);
    init();
    expect(mockSchedule).toHaveBeenCalledTimes(1);

    mockExecute.mockResolvedValue({ totalReclaimedBytes: 99 });
    jobFor('*/10 * * * *')();
    await flush();
    expect(mockRun).not.toHaveBeenCalled();

    mockExecute.mockResolvedValue({ totalReclaimedBytes: 100 });
    jobFor('*/10 * * * *')();
    await flush();
    expect(mockExecute).toHaveBeenCalledWith(host, policy, { dryRun: true });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith(resolved, policy, 'threshold');
  });

  test('the threshold check leaves busy hosts alone', async () => {
    mockPolicies.mockReturnValue([makePolicy({ cron: '', thresholdBytes: 1 })]);
    mockBusy.mockReturnValue(true);
    init();
    jobFor('*/15 * * * *')();
    await flush();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  test('a policy with both schedules both jobs', () => {
    mockPolicies.mockReturnValue([makePolicy({ thresholdBytes: 5 })]);
    init();
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });

  test('a failing job is logged, not thrown', async () => {
    mockPolicies.mockReturnValue([makePolicy({ cron: '0 3 * * *' })]);
    mockRun.mockRejectedValue(new Error('boom'));
    init();
    jobFor('0 3 * * *')();
    await flush();
    expect(mockRun).toHaveBeenCalled();
  });

  test('shutdown stops every task', () => {
    mockPolicies.mockReturnValue([makePolicy({ thresholdBytes: 5 })]);
    init();
    shutdown();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(getCleanupPolicyList()).toEqual([]);
  });
});
