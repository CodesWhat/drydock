import { vi } from 'vitest';
import {
  _resetContainerScanStateForTesting,
  beginContainerScan,
  isContainerScanning,
  onContainerScanStateChange,
  withTransientScanState,
} from './scan-state.js';

beforeEach(() => {
  _resetContainerScanStateForTesting();
});

describe('beginContainerScan', () => {
  test('marks the container and clears it on release', () => {
    const release = beginContainerScan('c1');
    expect(isContainerScanning('c1')).toBe(true);
    expect(isContainerScanning('c2')).toBe(false);

    release();
    expect(isContainerScanning('c1')).toBe(false);
  });

  test('is counted per container so overlapping scans clear only after the last one', () => {
    const releaseFirst = beginContainerScan('c1');
    const releaseSecond = beginContainerScan('c1');

    releaseFirst();
    expect(isContainerScanning('c1')).toBe(true);
    releaseSecond();
    expect(isContainerScanning('c1')).toBe(false);
  });

  test('release is idempotent and cannot steal another scan reference', () => {
    const releaseFirst = beginContainerScan('c1');
    const releaseSecond = beginContainerScan('c1');

    releaseFirst();
    releaseFirst();
    expect(isContainerScanning('c1')).toBe(true);
    releaseSecond();
    expect(isContainerScanning('c1')).toBe(false);
  });

  test('notifies listeners only on the first start and the last finish', () => {
    const listener = vi.fn();
    onContainerScanStateChange(listener);

    const releaseFirst = beginContainerScan('c1');
    const releaseSecond = beginContainerScan('c1');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith('c1', true);

    releaseFirst();
    expect(listener).toHaveBeenCalledTimes(1);
    releaseSecond();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith('c1', false);
  });

  test('a throwing listener neither fails nor leaks the scan', () => {
    onContainerScanStateChange(() => {
      throw new Error('listener broke');
    });
    const healthy = vi.fn();
    onContainerScanStateChange(healthy);

    const release = beginContainerScan('c1');
    expect(isContainerScanning('c1')).toBe(true);
    release();
    expect(isContainerScanning('c1')).toBe(false);
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  test('releasing after the registry was reset is harmless', () => {
    const release = beginContainerScan('c1');
    _resetContainerScanStateForTesting();

    expect(() => release()).not.toThrow();
    expect(isContainerScanning('c1')).toBe(false);
  });

  test('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsubscribe = onContainerScanStateChange(listener);
    unsubscribe();

    beginContainerScan('c1')();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('isContainerScanning', () => {
  test('is false for an undefined id', () => {
    expect(isContainerScanning(undefined)).toBe(false);
  });
});

describe('withTransientScanState', () => {
  test('adds the scanning state while a scan runs and leaves the input untouched', () => {
    const container = { id: 'c1', name: 'nginx' };
    const release = beginContainerScan('c1');

    expect(withTransientScanState(container)).toEqual({
      id: 'c1',
      name: 'nginx',
      securityScanState: 'scanning',
    });
    expect(container).toEqual({ id: 'c1', name: 'nginx' });

    release();
    expect(withTransientScanState(container)).toBe(container);
  });

  test('returns non-objects and id-less objects unchanged', () => {
    expect(withTransientScanState(undefined)).toBeUndefined();
    expect(withTransientScanState('text')).toBe('text');
    const noId = { name: 'x' };
    expect(withTransientScanState(noId)).toBe(noId);
  });
});
