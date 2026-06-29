import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { loadContainerDetailListState } from '@/views/containers/loadContainerDetailListState';
import {
  formatOperationPhase,
  formatOperationStatus,
  formatRollbackReason,
  formatTimestamp,
  useContainerBackups,
} from '@/views/containers/useContainerBackups';
import { useContainerPolicy } from '@/views/containers/useContainerPolicy';
import { useContainerPreview } from '@/views/containers/useContainerPreview';
import { useContainerTriggers } from '@/views/containers/useContainerTriggers';

describe('formatTimestamp (standalone, no t)', () => {
  it('returns "Unknown" when timestamp is undefined and t is not provided', () => {
    expect(formatTimestamp(undefined)).toBe('Unknown');
  });

  it('returns the i18n key result when timestamp is undefined and t is provided', () => {
    const mockT = vi.fn().mockReturnValue('Unknown translated');
    expect(formatTimestamp(undefined, mockT)).toBe('Unknown translated');
    expect(mockT).toHaveBeenCalledWith('containerComponents.backups.timestampUnknown');
  });
});

describe('formatOperationPhase / formatOperationStatus / formatRollbackReason (module-level, no t)', () => {
  it('returns "unknown" for non-string input when t is not provided', () => {
    expect(formatOperationPhase(null)).toBe('unknown');
    expect(formatOperationStatus(undefined)).toBe('unknown');
    expect(formatRollbackReason(42)).toBe('unknown');
  });

  it('returns the i18n key result when t is provided and input is non-string', () => {
    const mockT = vi.fn().mockReturnValue('Unknown translated');
    expect(formatOperationPhase(null, mockT)).toBe('Unknown translated');
    expect(mockT).toHaveBeenCalledWith('containerComponents.sideTabContent.unknown');
    mockT.mockClear();
    expect(formatOperationStatus(undefined, mockT)).toBe('Unknown translated');
    expect(mockT).toHaveBeenCalledWith('containerComponents.sideTabContent.unknown');
    mockT.mockClear();
    expect(formatRollbackReason(0, mockT)).toBe('Unknown translated');
    expect(mockT).toHaveBeenCalledWith('containerComponents.sideTabContent.unknown');
  });

  it('normalizes string values regardless of whether t is provided', () => {
    expect(formatOperationPhase('IN_PROGRESS')).toBe('in progress');
    expect(formatOperationStatus('ROLLED-BACK', vi.fn())).toBe('rolled back');
  });
});

describe('container action focused composables', () => {
  it('exports policy, preview, triggers, and backups composables', () => {
    expect(typeof useContainerPolicy).toBe('function');
    expect(typeof useContainerPreview).toBe('function');
    expect(typeof useContainerTriggers).toBe('function');
    expect(typeof useContainerBackups).toBe('function');
  });

  it('loads container detail list state from a loader', async () => {
    const loading = ref(false);
    const error = ref<string | null>(null);
    const value = ref<Record<string, unknown>[]>([{ stale: true }]);
    const loader = vi.fn().mockResolvedValue([{ id: 'a' }]);

    await loadContainerDetailListState({
      containerId: 'container-a',
      loading,
      error,
      value,
      loader,
      failureMessage: 'Failed to load detail list',
    });

    expect(loader).toHaveBeenCalledWith('container-a');
    expect(value.value).toEqual([{ id: 'a' }]);
    expect(error.value).toBeNull();
    expect(loading.value).toBe(false);
  });

  it('handles loader failures by clearing the list and setting an error', async () => {
    const loading = ref(false);
    const error = ref<string | null>(null);
    const value = ref<Record<string, unknown>[]>([{ stale: true }]);
    const loader = vi.fn().mockRejectedValue(new Error('boom'));

    await loadContainerDetailListState({
      containerId: 'container-b',
      loading,
      error,
      value,
      loader,
      failureMessage: 'Failed to load detail list',
    });

    expect(value.value).toEqual([]);
    expect(error.value).toBe('boom');
    expect(loading.value).toBe(false);
  });

  it('resets to an empty list when no container is selected', async () => {
    const loading = ref(false);
    const error = ref<string | null>('existing error');
    const value = ref<Record<string, unknown>[]>([{ stale: true }]);
    const loader = vi.fn();

    await loadContainerDetailListState({
      containerId: undefined,
      loading,
      error,
      value,
      loader,
      failureMessage: 'Failed to load detail list',
    });

    expect(loader).not.toHaveBeenCalled();
    expect(value.value).toEqual([]);
    expect(error.value).toBe('existing error');
    expect(loading.value).toBe(false);
  });
});
