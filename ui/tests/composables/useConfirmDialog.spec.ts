describe('useConfirmDialog', () => {
  async function loadComposable() {
    vi.resetModules();
    const mod = await import('@/composables/useConfirmDialog');
    return mod.useConfirmDialog;
  }

  it('starts hidden with no active dialog', async () => {
    const useConfirmDialog = await loadComposable();
    const dialog = useConfirmDialog();

    expect(dialog.visible.value).toBe(false);
    expect(dialog.current.value).toBeNull();
  });

  it('require opens the dialog with provided options', async () => {
    const useConfirmDialog = await loadComposable();
    const dialog = useConfirmDialog();
    const onAccept = vi.fn();
    const onReject = vi.fn();

    const options = {
      header: 'Delete container',
      message: 'This cannot be undone.',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      severity: 'danger' as const,
      accept: onAccept,
      reject: onReject,
    };

    dialog.require(options);

    expect(dialog.visible.value).toBe(true);
    expect(dialog.current.value).toStrictEqual(options);
  });

  it('accept invokes accept callback and clears state', async () => {
    const useConfirmDialog = await loadComposable();
    const dialog = useConfirmDialog();
    const onAccept = vi.fn();
    const onReject = vi.fn();

    dialog.require({
      header: 'Rollback image',
      message: 'Proceed with rollback?',
      accept: onAccept,
      reject: onReject,
    });

    await dialog.accept();

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
    expect(dialog.visible.value).toBe(false);
    expect(dialog.current.value).toBeNull();
  });

  it('closes dialog immediately and runs async callback in background', async () => {
    const useConfirmDialog = await loadComposable();
    const dialog = useConfirmDialog();
    let resolved = false;
    const asyncCallback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve();
          }, 50);
        }),
    );

    dialog.require({
      header: 'Stop Container',
      message: 'Stop nginx?',
      accept: asyncCallback,
    });

    const acceptPromise = dialog.accept();

    // Dialog closes immediately — no loading state blocks the UI
    expect(dialog.visible.value).toBe(false);
    expect(dialog.current.value).toBeNull();

    await acceptPromise;

    expect(resolved).toBe(true);
    expect(asyncCallback).toHaveBeenCalledTimes(1);
  });

  it('swallows callback errors without leaving stale state', async () => {
    const useConfirmDialog = await loadComposable();
    const dialog = useConfirmDialog();
    const failingCallback = vi.fn(() => Promise.reject(new Error('API failed')));

    dialog.require({
      header: 'Update',
      message: 'Update container?',
      accept: failingCallback,
    });

    await dialog.accept();

    expect(dialog.visible.value).toBe(false);
    expect(dialog.current.value).toBeNull();
  });

  it('reject invokes reject callback and clears state', async () => {
    const useConfirmDialog = await loadComposable();
    const dialog = useConfirmDialog();
    const onAccept = vi.fn();
    const onReject = vi.fn();

    dialog.require({
      header: 'Delete backup',
      message: 'Are you sure?',
      accept: onAccept,
      reject: onReject,
    });

    dialog.reject();

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    expect(dialog.visible.value).toBe(false);
    expect(dialog.current.value).toBeNull();
  });

  it('dismiss clears state without triggering callbacks', async () => {
    const useConfirmDialog = await loadComposable();
    const dialog = useConfirmDialog();
    const onAccept = vi.fn();
    const onReject = vi.fn();

    dialog.require({
      header: 'Delete trigger',
      message: 'Dismiss dialog',
      accept: onAccept,
      reject: onReject,
    });

    dialog.dismiss();

    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect(dialog.visible.value).toBe(false);
    expect(dialog.current.value).toBeNull();
  });

  it('accept and reject are safe when callbacks are not provided', async () => {
    const useConfirmDialog = await loadComposable();
    const dialog = useConfirmDialog();

    dialog.require({
      header: 'Delete server',
      message: 'No callbacks',
    });
    await expect(dialog.accept()).resolves.toBeUndefined();
    expect(dialog.visible.value).toBe(false);
    expect(dialog.current.value).toBeNull();

    dialog.require({
      header: 'Delete server',
      message: 'No callbacks',
    });
    expect(() => dialog.reject()).not.toThrow();
    expect(dialog.visible.value).toBe(false);
    expect(dialog.current.value).toBeNull();
  });

  it('shares dialog state across composable calls', async () => {
    const useConfirmDialog = await loadComposable();
    const first = useConfirmDialog();
    const second = useConfirmDialog();

    first.require({
      header: 'Delete app',
      message: 'Shared state check',
    });

    expect(second.visible.value).toBe(true);
    expect(second.current.value?.header).toBe('Delete app');

    second.dismiss();

    expect(first.visible.value).toBe(false);
    expect(first.current.value).toBeNull();
  });
});
