import { useSessionStorageItem } from '@/composables/useSessionStorageItem';

describe('useSessionStorageItem', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns null when key does not exist', () => {
    const item = useSessionStorageItem<string>('test-key');
    expect(item.read()).toBeNull();
  });

  it('reads a previously stored value', () => {
    sessionStorage.setItem('test-key', JSON.stringify({ a: 1 }));
    const item = useSessionStorageItem<{ a: number }>('test-key');
    expect(item.read()).toEqual({ a: 1 });
  });

  it('returns null when stored value is invalid json', () => {
    sessionStorage.setItem('test-key', '{not-json');
    const item = useSessionStorageItem<{ a: number }>('test-key');
    expect(item.read()).toBeNull();
  });

  it('returns null when validator rejects stored value', () => {
    sessionStorage.setItem('test-key', JSON.stringify({ a: 'bad' }));
    const item = useSessionStorageItem<{ a: number }>(
      'test-key',
      (value): value is { a: number } =>
        typeof value === 'object' && value !== null && 'a' in value && typeof value.a === 'number',
    );
    expect(item.read()).toBeNull();
  });

  it('writes a value to sessionStorage', () => {
    const item = useSessionStorageItem<{ a: number }>('test-key');
    item.write({ a: 2 });
    expect(sessionStorage.getItem('test-key')).toBe(JSON.stringify({ a: 2 }));
  });

  it('removes a value from sessionStorage', () => {
    const item = useSessionStorageItem<{ a: number }>('test-key');
    item.write({ a: 2 });
    expect(sessionStorage.getItem('test-key')).not.toBeNull();
    item.remove();
    expect(sessionStorage.getItem('test-key')).toBeNull();
  });

  it('does not throw when setItem fails', () => {
    const item = useSessionStorageItem<{ a: number }>('test-key');
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    try {
      expect(() => item.write({ a: 3 })).not.toThrow();
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
  });

  it('does not throw when removeItem fails', () => {
    const item = useSessionStorageItem<{ a: number }>('test-key');
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => {
      throw new Error('remove failed');
    };
    try {
      expect(() => item.remove()).not.toThrow();
    } finally {
      Storage.prototype.removeItem = originalRemoveItem;
    }
  });
});
