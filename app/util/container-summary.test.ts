import { describe, expect, test } from 'vitest';
import { getContainerStatusSummary, isContainerRunning } from './container-summary.js';

describe('isContainerRunning', () => {
  test('matches running status case-insensitively', () => {
    expect(isContainerRunning({ status: 'running' })).toBe(true);
    expect(isContainerRunning({ status: 'RUNNING' })).toBe(true);
  });

  test('treats missing or non-running status as false', () => {
    expect(isContainerRunning({ status: 'paused' })).toBe(false);
    expect(isContainerRunning({ status: undefined })).toBe(false);
    expect(isContainerRunning({})).toBe(false);
  });
});

describe('getContainerStatusSummary', () => {
  test('returns total, running, and stopped counts', () => {
    expect(
      getContainerStatusSummary([
        { status: 'running' },
        { status: 'exited' },
        { status: 'RUNNING' },
        {},
      ]),
    ).toEqual({
      total: 4,
      running: 2,
      stopped: 2,
    });
  });
});
