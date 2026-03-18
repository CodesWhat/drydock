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
  test('returns total, running, stopped, and updatesAvailable counts', () => {
    expect(
      getContainerStatusSummary([
        { status: 'running', updateAvailable: true },
        { status: 'exited', updateAvailable: false },
        { status: 'RUNNING', updateAvailable: true },
        {},
      ]),
    ).toEqual({
      total: 4,
      running: 2,
      stopped: 2,
      updatesAvailable: 2,
    });
  });

  test('returns zero updatesAvailable when no containers have updates', () => {
    expect(
      getContainerStatusSummary([
        { status: 'running', updateAvailable: false },
        { status: 'running' },
      ]),
    ).toEqual({
      total: 2,
      running: 2,
      stopped: 0,
      updatesAvailable: 0,
    });
  });
});
