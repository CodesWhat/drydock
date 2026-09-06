import { describe, expect, test, vi } from 'vitest';
import { triggerManualWatch } from './manual-watch.js';

describe('triggerManualWatch', () => {
  test('calls watch() directly and reports coalesced=false for a watcher with no cron orchestration', async () => {
    const reports = [{ id: 'c1' }];
    const watch = vi.fn().mockResolvedValue(reports);
    const watcher = { watch };

    const result = await triggerManualWatch(watcher, 'webhook');

    expect(watch).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({ reports, coalesced: false });
  });

  test('routes through watchFromCron with ignoreMaintenanceWindow and the given reason', async () => {
    const reports = [{ id: 'c1' }];
    const watchFromCron = vi.fn().mockResolvedValue(reports);
    const watcher = {
      watch: vi.fn(),
      watchFromCron,
      cronWatchInFlight: undefined,
    };

    const result = await triggerManualWatch(watcher, 'api');

    expect(watcher.watch).not.toHaveBeenCalled();
    expect(watchFromCron).toHaveBeenCalledWith({ ignoreMaintenanceWindow: true, reason: 'api' });
    expect(result).toStrictEqual({ reports, coalesced: false });
  });

  test('reports coalesced=true when a scan was already in flight before the call', async () => {
    const reports = [{ id: 'c1' }];
    const inFlight = Promise.resolve(reports);
    const watchFromCron = vi.fn().mockResolvedValue(reports);
    const watcher = {
      watch: vi.fn(),
      watchFromCron,
      cronWatchInFlight: inFlight,
    };

    const result = await triggerManualWatch(watcher, 'agent-poll');

    expect(result).toStrictEqual({ reports, coalesced: true });
  });
});
