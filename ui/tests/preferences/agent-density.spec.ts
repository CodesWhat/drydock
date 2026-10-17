import { nextTick } from 'vue';
import { migrate } from '@/preferences/migrate';
import { CURRENT_SCHEMA_VERSION } from '@/preferences/schema';
import { getPreferences, updatePreferences } from '@/services/preferences';

vi.mock('@/services/preferences', () => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));

describe('Agents density preferences', () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it.each([undefined, null, true, 42, {}, [], 'dense', 'COMPACT'].map((density) => ({ density })))(
    'defaults invalid or missing density $density to normal',
    ({ density }) => {
      const result = migrate({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        views: { agents: { density, mode: 'cards', hiddenColumns: ['os'] } },
      });
      expect(result.views.agents.density).toBe('normal');
      expect(result.views.agents.mode).toBe('cards');
      expect(result.views.agents.hiddenColumns).toEqual(['os']);
    },
  );

  it.each(['normal', 'compact'])(
    'retains valid %s density without changing other views',
    (density) => {
      const result = migrate({ views: { agents: { density }, audit: { mode: 'cards' } } });
      expect(result.views.agents.density).toBe(density);
      expect(result.views.audit.mode).toBe('cards');
      expect(result.views.audit).not.toHaveProperty('density');
      expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    },
  );

  it('saves, reloads and resets the Agents choice through the real preference store', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const first = await import('@/preferences/store');
    first.resetPreferences();
    first.preferences.views.agents.density = 'compact';
    await nextTick();
    await vi.runAllTimersAsync();
    expect(JSON.parse(localStorage.getItem('dd-preferences') ?? '{}').views.agents.density).toBe(
      'compact',
    );
    vi.resetModules();
    const reloaded = await import('@/preferences/store');
    expect(reloaded.preferences.views.agents.density).toBe('compact');
    reloaded.resetPreferences();
    expect(reloaded.preferences.views.agents.density).toBe('normal');
    await nextTick();
    await vi.runAllTimersAsync();
  });

  it('keeps local edits offline and uses the existing opt-in sync for density', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { preferences, resetPreferences } = await import('@/preferences/store');
    resetPreferences();
    await nextTick();
    await vi.runAllTimersAsync();
    const listeners = vi.spyOn(globalThis, 'addEventListener');
    const sync = await import('@/preferences/sync');
    try {
      preferences.views.agents.density = 'compact';
      await nextTick();
      await vi.runAllTimersAsync();
      expect(updatePreferences).not.toHaveBeenCalled();
      vi.mocked(getPreferences).mockResolvedValue({
        apiVersion: 1,
        username: 'alice',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        preferences: { views: { agents: { density: 'compact' } }, sync: { enabled: true } },
        updatedAt: '2026-09-15T23:00:00Z',
      });
      preferences.views.agents.density = 'normal';
      await nextTick();
      await sync.hydrateFromServer('alice');
      expect(preferences.views.agents.density).toBe('compact');
      await vi.runAllTimersAsync();
      expect(updatePreferences).not.toHaveBeenCalled();
      preferences.views.agents.density = 'normal';
      await nextTick();
      await vi.runAllTimersAsync();
      expect(updatePreferences).toHaveBeenCalledWith(
        CURRENT_SCHEMA_VERSION,
        expect.objectContaining({
          views: expect.objectContaining({
            agents: expect.objectContaining({ density: 'normal' }),
          }),
        }),
      );
    } finally {
      preferences.sync.enabled = false;
      await nextTick();
      await vi.runAllTimersAsync();
      for (const [name, listener] of listeners.mock.calls) {
        globalThis.removeEventListener(name, listener);
      }
      listeners.mockRestore();
    }
  });
});
