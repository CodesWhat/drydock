import { getWatcherConfiguration } from '@/views/dashboard/watcherConfiguration';

describe('getWatcherConfiguration', () => {
  it('returns watcher.configuration when present', () => {
    expect(
      getWatcherConfiguration({ configuration: { maintenanceWindow: 'Sun 02:00-03:00 UTC' } }),
    ).toEqual({
      maintenanceWindow: 'Sun 02:00-03:00 UTC',
    });
  });

  it('falls back to watcher.config when configuration is missing', () => {
    expect(
      getWatcherConfiguration({ config: { maintenancewindow: 'Mon 01:00-02:00 UTC' } }),
    ).toEqual({
      maintenancewindow: 'Mon 01:00-02:00 UTC',
    });
  });

  it('returns empty configuration when watcher payload has no config object', () => {
    expect(getWatcherConfiguration({})).toEqual({});
    expect(getWatcherConfiguration(null)).toEqual({});
  });
});
