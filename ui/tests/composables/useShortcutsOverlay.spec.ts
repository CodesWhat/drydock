describe('useShortcutsOverlay', () => {
  async function loadComposable() {
    vi.resetModules();
    const mod = await import('@/composables/useShortcutsOverlay');
    return mod.useShortcutsOverlay;
  }

  it('starts hidden', async () => {
    const useShortcutsOverlay = await loadComposable();
    const overlay = useShortcutsOverlay();

    expect(overlay.visible.value).toBe(false);
  });

  it('open sets visible true', async () => {
    const useShortcutsOverlay = await loadComposable();
    const overlay = useShortcutsOverlay();

    overlay.open();

    expect(overlay.visible.value).toBe(true);
  });

  it('close sets visible false', async () => {
    const useShortcutsOverlay = await loadComposable();
    const overlay = useShortcutsOverlay();

    overlay.open();
    overlay.close();

    expect(overlay.visible.value).toBe(false);
  });

  it('shares state across multiple useShortcutsOverlay() calls', async () => {
    const useShortcutsOverlay = await loadComposable();
    const first = useShortcutsOverlay();
    const second = useShortcutsOverlay();

    first.open();

    expect(second.visible.value).toBe(true);

    second.close();

    expect(first.visible.value).toBe(false);
  });
});
