import { describe, expect, test, vi } from 'vitest';
import { recordLegacyInput } from '../prometheus/compatibility.js';
import { getPreferredLabelValue } from './legacy-label.js';

vi.mock('../prometheus/compatibility.js', () => ({
  recordLegacyInput: vi.fn(),
}));

describe('getPreferredLabelValue', () => {
  test('returns dd label value when both dd and wud labels are present', () => {
    expect(
      getPreferredLabelValue(
        { 'dd.watch': 'dd-value', 'wud.watch': 'legacy-value' },
        'dd.watch',
        'wud.watch',
      ),
    ).toBe('dd-value');
  });

  test('falls back to wud label and logs deprecation once per key', () => {
    const warnedFallbacks = new Set<string>();
    const warn = vi.fn();

    expect(
      getPreferredLabelValue({ 'wud.watch': 'legacy-1' }, 'dd.watch', 'wud.watch', {
        warnedFallbacks,
        warn,
      }),
    ).toBe('legacy-1');
    expect(
      getPreferredLabelValue({ 'wud.watch': 'legacy-2' }, 'dd.watch', 'wud.watch', {
        warnedFallbacks,
        warn,
      }),
    ).toBe('legacy-2');

    expect(recordLegacyInput).toHaveBeenCalledTimes(2);
    expect(recordLegacyInput).toHaveBeenCalledWith('label', 'wud.watch');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Legacy Docker label "wud.watch" is deprecated. Please migrate to "dd.watch" before fallback support is removed.',
    );
  });

  test('returns undefined when no fallback key is provided or no key exists', () => {
    expect(getPreferredLabelValue({}, 'dd.watch')).toBeUndefined();
    expect(getPreferredLabelValue({ 'dd.watch': 'yes' }, 'dd.watch', 'wud.watch')).toBe('yes');
    expect(getPreferredLabelValue({}, 'dd.watch', 'wud.watch')).toBeUndefined();
  });

  test('uses shared fallback warning registry when warnedFallbacks is not provided', () => {
    vi.clearAllMocks();
    const warn = vi.fn();

    expect(
      getPreferredLabelValue({ 'wud.unique-key': 'legacy-1' }, 'dd.watch', 'wud.unique-key', {
        warn,
      }),
    ).toBe('legacy-1');
    expect(
      getPreferredLabelValue({ 'wud.unique-key': 'legacy-2' }, 'dd.watch', 'wud.unique-key', {
        warn,
      }),
    ).toBe('legacy-2');

    expect(recordLegacyInput).toHaveBeenCalledWith('label', 'wud.unique-key');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
