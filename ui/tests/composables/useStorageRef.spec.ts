import { nextTick } from 'vue';
import { useStorageRef } from '@/composables/useStorageRef';

describe('useStorageRef', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return the default value when localStorage is empty', () => {
    const result = useStorageRef('test-key', 'default');
    expect(result.value).toBe('default');
  });

  it('should load a previously stored string value', () => {
    localStorage.setItem('test-key', JSON.stringify('saved'));
    const result = useStorageRef('test-key', 'default');
    expect(result.value).toBe('saved');
  });

  it('should load a previously stored boolean value', () => {
    localStorage.setItem('test-bool', JSON.stringify(true));
    const result = useStorageRef('test-bool', false);
    expect(result.value).toBe(true);
  });

  it('should load a previously stored number value', () => {
    localStorage.setItem('test-num', JSON.stringify(42));
    const result = useStorageRef('test-num', 0);
    expect(result.value).toBe(42);
  });

  it('should fall back to default when stored value is corrupt JSON', () => {
    localStorage.setItem('test-key', '{not valid json');
    const result = useStorageRef('test-key', 'default');
    expect(result.value).toBe('default');
  });

  it('should fall back to default when stored type does not match', () => {
    localStorage.setItem('test-key', JSON.stringify(123));
    const result = useStorageRef('test-key', 'default');
    expect(result.value).toBe('default');
  });

  it('should persist changes to localStorage on watch trigger', async () => {
    const result = useStorageRef('test-key', 'initial');
    result.value = 'updated';
    await nextTick();
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify('updated'));
  });

  it('should use the validator when provided', () => {
    localStorage.setItem('test-key', JSON.stringify('cards'));
    const modes = new Set(['table', 'cards', 'list']);
    const result = useStorageRef<'table' | 'cards' | 'list'>(
      'test-key',
      'table',
      (v): v is 'table' | 'cards' | 'list' => typeof v === 'string' && modes.has(v),
    );
    expect(result.value).toBe('cards');
  });

  it('should reject invalid values when validator is provided', () => {
    localStorage.setItem('test-key', JSON.stringify('invalid-mode'));
    const modes = new Set(['table', 'cards', 'list']);
    const result = useStorageRef<'table' | 'cards' | 'list'>(
      'test-key',
      'table',
      (v): v is 'table' | 'cards' | 'list' => typeof v === 'string' && modes.has(v),
    );
    expect(result.value).toBe('table');
  });

  it('should validate boolean values with a validator', () => {
    localStorage.setItem('test-bool', JSON.stringify('not-a-boolean'));
    const result = useStorageRef('test-bool', false, (v): v is boolean => typeof v === 'boolean');
    expect(result.value).toBe(false);
  });

  it('should handle localStorage.getItem returning null gracefully', () => {
    const result = useStorageRef('nonexistent-key', 42);
    expect(result.value).toBe(42);
  });

  it('should persist object values', async () => {
    const result = useStorageRef('test-obj', { a: 1 });
    result.value = { a: 2 };
    await nextTick();
    const raw = localStorage.getItem('test-obj');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ a: 2 });
  });

  it('should survive localStorage.setItem throwing', async () => {
    const result = useStorageRef('test-key', 'initial');
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    try {
      result.value = 'updated';
      await nextTick();
      // Should not throw — silently ignored
      expect(result.value).toBe('updated');
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
  });
});
