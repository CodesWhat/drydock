import { useClipboard } from '@/composables/useClipboard';

describe('useClipboard', () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
    // Flush any lingering state from a previous test
    const { copyToClipboard } = useClipboard();
    await copyToClipboard('__reset__');
    vi.advanceTimersByTime(1500);
    writeTextMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as any).execCommand;
    delete (document as any).activeElement;
  });

  it('calls navigator.clipboard.writeText with the correct text', async () => {
    const { copyToClipboard } = useClipboard();
    await copyToClipboard('hello world');
    expect(writeTextMock).toHaveBeenCalledWith('hello world');
  });

  it('resolves true on a successful async copy', async () => {
    const { copyToClipboard } = useClipboard();
    const result = await copyToClipboard('hello world');
    expect(result).toBe(true);
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

  it('falls back to execCommand when navigator.clipboard is undefined', async () => {
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(true);
    const { copyToClipboard, isCopied } = useClipboard();

    const result = await copyToClipboard('x', 'key-undefined');

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(result).toBe(true);
    expect(isCopied('key-undefined')).toBe(true);
  });

  it('falls back to execCommand when clipboard.writeText is missing', async () => {
    Object.assign(navigator, { clipboard: {} });
    document.execCommand = vi.fn().mockReturnValue(true);
    const { copyToClipboard, isCopied } = useClipboard();

    const result = await copyToClipboard('x', 'key-missing-writeText');

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(result).toBe(true);
    expect(isCopied('key-missing-writeText')).toBe(true);
  });

  it('falls back to execCommand when the async clipboard write rejects', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('NotAllowedError'));
    document.execCommand = vi.fn().mockReturnValue(true);
    const { copyToClipboard, isCopied, isFailed } = useClipboard();

    await expect(copyToClipboard('x', 'k')).resolves.toBe(true);

    expect(document.execCommand).toHaveBeenCalled();
    expect(isCopied('k')).toBe(true);
    expect(isFailed('k')).toBe(false);
  });

  it('marks the key failed when neither clipboard API nor execCommand are available', async () => {
    Object.assign(navigator, { clipboard: undefined });
    const { copyToClipboard, isCopied, isFailed } = useClipboard();

    const result = await copyToClipboard('x', 'k');

    expect(result).toBe(false);
    expect(isFailed('k')).toBe(true);
    expect(isCopied('k')).toBe(false);
  });

  it('marks the key failed when execCommand returns false', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('denied'));
    document.execCommand = vi.fn().mockReturnValue(false);
    const { copyToClipboard, isCopied, isFailed } = useClipboard();

    const result = await copyToClipboard('x', 'k');

    expect(result).toBe(false);
    expect(isFailed('k')).toBe(true);
    expect(isCopied('k')).toBe(false);
  });

  it('marks the key failed when execCommand throws', async () => {
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error('blocked');
    });
    const { copyToClipboard, isFailed } = useClipboard();

    const result = await copyToClipboard('x', 'k');

    expect(result).toBe(false);
    expect(isFailed('k')).toBe(true);
  });

  it('cleans up without leaking the textarea when appendChild throws (e.g. a sandboxed iframe)', async () => {
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(true);
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
      throw new Error('denied');
    });
    const { copyToClipboard, isFailed } = useClipboard();

    const result = await copyToClipboard('x', 'k');

    expect(result).toBe(false);
    expect(isFailed('k')).toBe(true);
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(document.querySelectorAll('textarea')).toHaveLength(0);

    appendChildSpy.mockRestore();
  });

  it('cleans up without leaking the textarea when select() throws before execCommand runs', async () => {
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(true);
    const selectSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { copyToClipboard, isFailed } = useClipboard();

    const result = await copyToClipboard('x', 'k');

    expect(result).toBe(false);
    expect(isFailed('k')).toBe(true);
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(document.querySelectorAll('textarea')).toHaveLength(0);

    selectSpy.mockRestore();
  });

  it('restores focus to the previously focused element after a legacy copy', async () => {
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(true);
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    const { copyToClipboard } = useClipboard();

    await copyToClipboard('x');

    expect(focusSpy).toHaveBeenCalled();
  });

  it('does not throw when there is nothing to refocus', async () => {
    Object.defineProperty(document, 'activeElement', { value: null, configurable: true });
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(true);
    const { copyToClipboard } = useClipboard();

    await expect(copyToClipboard('x')).resolves.toBe(true);
  });

  it('isFailed returns false after 1500ms timeout', async () => {
    Object.assign(navigator, { clipboard: undefined });
    const { copyToClipboard, isFailed } = useClipboard();

    await copyToClipboard('x', 'k');
    expect(isFailed('k')).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(isFailed('k')).toBe(false);
  });

  it('a subsequent successful copy clears a previous failedKey', async () => {
    const { copyToClipboard, isFailed, isCopied } = useClipboard();
    Object.assign(navigator, { clipboard: undefined });
    await copyToClipboard('first', 'key-a');
    expect(isFailed('key-a')).toBe(true);

    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    await copyToClipboard('second', 'key-b');
    expect(isFailed('key-a')).toBe(false);
    expect(isCopied('key-b')).toBe(true);
  });

  it('a subsequent failed copy clears a previous copiedKey', async () => {
    const { copyToClipboard, isFailed, isCopied } = useClipboard();
    await copyToClipboard('first', 'key-a');
    expect(isCopied('key-a')).toBe(true);

    Object.assign(navigator, { clipboard: undefined });
    await copyToClipboard('second', 'key-b');
    expect(isCopied('key-a')).toBe(false);
    expect(isFailed('key-b')).toBe(true);
  });
});
