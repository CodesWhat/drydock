const { mockSweep, mockWarn, mockRecordOffline } = vi.hoisted(() => ({
  mockSweep: vi.fn(),
  mockWarn: vi.fn(),
  mockRecordOffline: vi.fn(),
}));

vi.mock('../log/index.js', () => ({ default: { warn: mockWarn, child: vi.fn() } }));
vi.mock('../store/totp.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store/totp.js')>()),
  sweepExpiredEnrollments: mockSweep,
}));

vi.mock('./totp-offline-audit.js', () => ({ recordOfflineTotpOperations: mockRecordOffline }));

import { init } from './totp-factor.js';

describe('start-up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('records what an offline command did while Drydock was stopped', () => {
    init();

    expect(mockRecordOffline).toHaveBeenCalledTimes(1);
  });
});

describe('the hourly enrollment sweep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('deletes expired enrollments every hour, once per timer even after a second init', () => {
    init();
    init();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(mockSweep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(mockSweep).toHaveBeenCalledTimes(2);
  });

  test('a store fault is logged and the timer keeps running', () => {
    mockSweep.mockImplementationOnce(() => {
      throw new Error('store down');
    });
    init();
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('store down'));
    expect(mockSweep).toHaveBeenCalledTimes(2);
  });
});
