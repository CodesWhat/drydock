import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useToast } from '../../src/composables/useToast';

beforeEach(() => {
  const { toasts, dismissToast } = useToast();
  for (const t of [...toasts.value]) {
    dismissToast(t.id);
  }
});

describe('useToast', () => {
  test('addToast adds a toast to the list', () => {
    const { addToast, toasts } = useToast();
    addToast('Test title', { tone: 'error', body: 'Test body', duration: 0 });
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].title).toBe('Test title');
    expect(toasts.value[0].body).toBe('Test body');
    expect(toasts.value[0].tone).toBe('error');
  });

  test('dismissToast removes a toast by id', () => {
    const { addToast, toasts, dismissToast } = useToast();
    addToast('Toast 1', { duration: 0 });
    addToast('Toast 2', { duration: 0 });
    expect(toasts.value).toHaveLength(2);
    dismissToast(toasts.value[0].id);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].title).toBe('Toast 2');
  });

  test('error helper sets tone to error', () => {
    const { error, toasts } = useToast();
    error('Fail', 'Details');
    expect(toasts.value[0].tone).toBe('error');
    expect(toasts.value[0].title).toBe('Fail');
    expect(toasts.value[0].body).toBe('Details');
  });

  test('success helper sets tone to success', () => {
    const { success, toasts } = useToast();
    success('Done');
    expect(toasts.value[0].tone).toBe('success');
  });

  test('warning helper sets tone to warning', () => {
    const { warning, toasts } = useToast();
    warning('Careful');
    expect(toasts.value[0].tone).toBe('warning');
  });

  test('info helper sets tone to info', () => {
    const { info, toasts } = useToast();
    info('FYI');
    expect(toasts.value[0].tone).toBe('info');
  });

  test('auto-dismisses after duration', () => {
    vi.useFakeTimers();
    const { addToast, toasts } = useToast();
    addToast('Temporary', { duration: 3000 });
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(toasts.value).toHaveLength(0);
    vi.useRealTimers();
  });

  test('addToast defaults to info tone and auto-dismiss', () => {
    vi.useFakeTimers();
    const { addToast, toasts } = useToast();
    addToast('Default');
    expect(toasts.value[0].tone).toBe('info');
    vi.advanceTimersByTime(6000);
    expect(toasts.value).toHaveLength(0);
    vi.useRealTimers();
  });

  test('shares state across multiple useToast calls', () => {
    const a = useToast();
    const b = useToast();
    a.error('From A');
    expect(b.toasts.value).toHaveLength(1);
    expect(b.toasts.value[0].title).toBe('From A');
  });
});
