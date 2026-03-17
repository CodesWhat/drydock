import { useClipboard } from '@/composables/useClipboard';

describe('useClipboard', () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
    // Flush any lingering state from a previous test
    const { copyToClipboard } = useClipboard();
    copyToClipboard('__reset__');
    vi.advanceTimersByTime(1500);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls navigator.clipboard.writeText with the correct text', async () => {
    const { copyToClipboard } = useClipboard();
    await copyToClipboard('hello world');
    expect(writeTextMock).toHaveBeenCalledWith('hello world');
  });

  it('isCopied returns true for the copied key after copying', async () => {
    const { copyToClipboard, isCopied } = useClipboard();
    await copyToClipboard('some text', 'my-key');
    expect(isCopied('my-key')).toBe(true);
  });

  it('isCopied uses text as key when no key is provided', async () => {
    const { copyToClipboard, isCopied } = useClipboard();
    await copyToClipboard('fallback-key');
    expect(isCopied('fallback-key')).toBe(true);
  });

  it('isCopied returns false after 1500ms timeout', async () => {
    const { copyToClipboard, isCopied } = useClipboard();
    await copyToClipboard('text', 'key');
    expect(isCopied('key')).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(isCopied('key')).toBe(false);
  });

  it('copying a new value replaces the previous copiedKey', async () => {
    const { copyToClipboard, isCopied } = useClipboard();
    await copyToClipboard('first', 'key-a');
    expect(isCopied('key-a')).toBe(true);

    await copyToClipboard('second', 'key-b');
    expect(isCopied('key-a')).toBe(false);
    expect(isCopied('key-b')).toBe(true);
  });

  it('copiedKey reflects state after copy', async () => {
    const { copyToClipboard, copiedKey } = useClipboard();
    await copyToClipboard('test-value');
    expect(copiedKey.value).toBe('test-value');

    vi.advanceTimersByTime(1500);
    expect(copiedKey.value).toBeNull();
  });

  it('multiple calls reset the timer so second copy persists', async () => {
    const { copyToClipboard, isCopied } = useClipboard();

    await copyToClipboard('first', 'key-1');
    expect(isCopied('key-1')).toBe(true);

    // Advance 1000ms (still within first timer)
    vi.advanceTimersByTime(1000);
    expect(isCopied('key-1')).toBe(true);

    // Copy again — this should reset the timer
    await copyToClipboard('second', 'key-2');
    expect(isCopied('key-2')).toBe(true);

    // Advance 1000ms from second call (1500ms would have elapsed from the first call)
    vi.advanceTimersByTime(1000);
    // Should still be copied because the timer was reset by the second call
    expect(isCopied('key-2')).toBe(true);

    // Advance remaining 500ms to hit 1500ms from second call
    vi.advanceTimersByTime(500);
    expect(isCopied('key-2')).toBe(false);
  });
});
