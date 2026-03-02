import { setTestPreferences } from './preferences';

describe('setTestPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not persist unknown top-level keys', () => {
    setTestPreferences({ unknownKey: 'value' } as unknown as Parameters<
      typeof setTestPreferences
    >[0]);

    const stored = localStorage.getItem('dd-preferences');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).not.toHaveProperty('unknownKey');
  });
});
