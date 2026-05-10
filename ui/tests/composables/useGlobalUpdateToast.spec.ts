import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { useGlobalUpdateToast } from '@/composables/useGlobalUpdateToast';
import { OPERATION_DISPLAY_HOLD_MS } from '@/composables/useOperationDisplayHold';
import { useToast } from '@/composables/useToast';
import { useToastStore } from '@/stores/toast';

function mountGlobalToast() {
  const wrapper = mount(
    defineComponent({
      setup() {
        useGlobalUpdateToast();
        return {};
      },
      template: '<div />',
    }),
  );
  return { wrapper, toast: useToast() };
}

function dispatch(event: string, detail: Record<string, unknown>) {
  globalThis.dispatchEvent(new CustomEvent(event, { detail }));
}

async function settle() {
  await vi.advanceTimersByTimeAsync(OPERATION_DISPLAY_HOLD_MS);
  await nextTick();
}

describe('useGlobalUpdateToast', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('dd:sse-update-applied', () => {
    it('fires success toast after settle delay', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        containerId: 'c1',
        containerName: 'nginx',
        operationId: 'op-1',
        batchId: null,
      });
      await nextTick();
      expect(toast.toasts.value).toHaveLength(before);

      await settle();
      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0]).toMatchObject({ tone: 'success', title: 'Updated: nginx' });

      wrapper.unmount();
    });

    it('fires success toast even when operationId is missing', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', { containerName: 'nginx', batchId: null });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0]).toMatchObject({ tone: 'success', title: 'Updated: nginx' });

      wrapper.unmount();
    });

    it('fires success toast when operationId is empty string', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        containerName: 'nginx',
        operationId: '',
        batchId: null,
      });
      await settle();

      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      wrapper.unmount();
    });

    it('falls back to "container" name when containerName is missing', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', { operationId: 'op-fallback', batchId: null });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].title).toBe('Updated: container');

      wrapper.unmount();
    });

    it('suppresses per-container toast when batchId is non-null', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        containerName: 'nginx',
        operationId: 'op-batch',
        batchId: 'batch-1',
      });
      await settle();

      expect(toast.toasts.value.slice(before)).toHaveLength(0);

      wrapper.unmount();
    });

    it('deduplicates by operationId across replays', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      const detail = {
        containerName: 'nginx',
        operationId: 'op-dedup',
        batchId: null,
      };
      dispatch('dd:sse-update-applied', detail);
      dispatch('dd:sse-update-applied', detail);
      await settle();

      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      wrapper.unmount();
    });

    it('does not deduplicate when operationId is missing', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', { containerName: 'nginx', batchId: null });
      dispatch('dd:sse-update-applied', { containerName: 'redis', batchId: null });
      await settle();

      const titles = toast.toasts.value.slice(before).map((t) => t.title);
      expect(titles).toEqual(['Updated: nginx', 'Updated: redis']);

      wrapper.unmount();
    });

    it('allows the same operationId to fire again after the dedup TTL expires', async () => {
      const { wrapper } = mountGlobalToast();
      const store = useToastStore();
      const addSpy = vi.spyOn(store, 'add');
      const detail = {
        containerName: 'nginx',
        operationId: 'op-ttl',
        batchId: null,
      };

      dispatch('dd:sse-update-applied', detail);
      await settle();
      expect(addSpy).toHaveBeenCalledTimes(1);

      // Advance past the 5-minute completed-operation TTL so the dedup entry is cleared.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      dispatch('dd:sse-update-applied', detail);
      await settle();
      expect(addSpy).toHaveBeenCalledTimes(2);

      addSpy.mockRestore();
      wrapper.unmount();
    });

    it('ignores events with no detail', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      globalThis.dispatchEvent(new Event('dd:sse-update-applied'));
      await settle();

      expect(toast.toasts.value.slice(before)).toHaveLength(0);

      wrapper.unmount();
    });
  });

  describe('dd:sse-update-failed', () => {
    it('fires error toast for plain failure', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', {
        containerName: 'nginx',
        operationId: 'op-f1',
        error: 'docker pull failed',
        batchId: null,
      });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('error');
      expect(newToasts[0].title).toContain('nginx');

      wrapper.unmount();
    });

    it('fires warning toast for rolled-back failure', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', {
        containerName: 'nginx',
        operationId: 'op-rb',
        error: 'health-check failed',
        rollbackReason: 'health-check',
        batchId: null,
      });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('warning');
      expect(newToasts[0].title).toContain('nginx');

      wrapper.unmount();
    });

    it('fires success toast for cancelled (rollbackReason=cancelled)', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', {
        containerName: 'nginx',
        operationId: 'op-cancel',
        rollbackReason: 'cancelled',
        batchId: null,
      });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('success');
      expect(newToasts[0].title).toBe('Cancelled: nginx');

      wrapper.unmount();
    });

    it('fires success toast for cancelled (error="Cancelled by operator")', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', {
        containerName: 'nginx',
        operationId: 'op-cancel-2',
        error: 'Cancelled by operator',
        rollbackReason: 'operator-cancel',
        batchId: null,
      });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('success');
      expect(newToasts[0].title).toBe('Cancelled: nginx');

      wrapper.unmount();
    });

    it('fires failure toast even when operationId is missing', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', {
        containerName: 'nginx',
        error: 'pull failed',
        batchId: null,
      });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('error');

      wrapper.unmount();
    });

    it('suppresses per-container failure toast when batchId is non-null', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', {
        containerName: 'nginx',
        operationId: 'op-bf',
        error: 'pull failed',
        batchId: 'batch-9',
      });
      await settle();

      expect(toast.toasts.value.slice(before)).toHaveLength(0);

      wrapper.unmount();
    });

    it('deduplicates update-failed by operationId across replays', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      const detail = {
        containerName: 'nginx',
        operationId: 'op-fail-dedup',
        error: 'pull failed',
        batchId: null,
      };
      dispatch('dd:sse-update-failed', detail);
      dispatch('dd:sse-update-failed', detail);
      await settle();

      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      wrapper.unmount();
    });

    it('allows the same operationId to fire again after the dedup TTL expires', async () => {
      const { wrapper } = mountGlobalToast();
      const store = useToastStore();
      const addSpy = vi.spyOn(store, 'add');
      const detail = {
        containerName: 'nginx',
        operationId: 'op-fail-ttl',
        error: 'pull failed',
        batchId: null,
      };

      dispatch('dd:sse-update-failed', detail);
      await settle();
      expect(addSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      dispatch('dd:sse-update-failed', detail);
      await settle();
      expect(addSpy).toHaveBeenCalledTimes(2);

      addSpy.mockRestore();
      wrapper.unmount();
    });

    it('falls back to plain rolledBack copy when reason is unknown', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', {
        containerName: 'nginx',
        operationId: 'op-rb-noreason',
        rollbackReason: '',
        batchId: null,
      });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('error');

      wrapper.unmount();
    });

    it('ignores events with no detail', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      globalThis.dispatchEvent(new Event('dd:sse-update-failed'));
      await settle();

      expect(toast.toasts.value.slice(before)).toHaveLength(0);

      wrapper.unmount();
    });

    it('falls back to "container" name on failure when containerName is missing', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', { error: 'pull failed', batchId: null });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].title).toContain('container');

      wrapper.unmount();
    });

    it('uses plain rolledBack copy when rollbackReason is whitespace and no error is set', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', {
        containerName: 'nginx',
        rollbackReason: '   ',
        batchId: null,
      });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('warning');
      expect(newToasts[0].title).toBe('Rolled back: nginx');

      wrapper.unmount();
    });

    it('uses plain updateFailed copy when no error and no rollbackReason are set', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-failed', { containerName: 'nginx', batchId: null });
      await settle();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('error');
      expect(newToasts[0].title).toBe('Update failed: nginx');

      wrapper.unmount();
    });
  });

  describe('dd:sse-batch-update-completed', () => {
    it('fires success toast when all containers succeeded', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-batch-update-completed', {
        batchId: 'batch-success',
        total: 3,
        succeeded: 3,
        failed: 0,
        items: [],
      });
      await nextTick();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0]).toMatchObject({
        tone: 'success',
        title: 'Updated 3 containers',
      });

      wrapper.unmount();
    });

    it('fires error toast when all containers failed', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-batch-update-completed', {
        batchId: 'batch-failed',
        total: 2,
        succeeded: 0,
        failed: 2,
        items: [],
      });
      await nextTick();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0]).toMatchObject({
        tone: 'error',
        title: 'Failed to update 2 containers',
      });

      wrapper.unmount();
    });

    it('fires warning toast for partial success', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-batch-update-completed', {
        batchId: 'batch-partial',
        total: 5,
        succeeded: 3,
        failed: 2,
        items: [],
      });
      await nextTick();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0]).toMatchObject({
        tone: 'warning',
        title: 'Updated 3 of 5 containers; 2 failed',
      });

      wrapper.unmount();
    });

    it('deduplicates by batchId on replay', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      const detail = {
        batchId: 'batch-dedup',
        total: 1,
        succeeded: 1,
        failed: 0,
        items: [],
      };
      dispatch('dd:sse-batch-update-completed', detail);
      dispatch('dd:sse-batch-update-completed', detail);
      await nextTick();

      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      wrapper.unmount();
    });

    it('still fires a toast when batchId is missing entirely', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-batch-update-completed', {
        total: 1,
        succeeded: 1,
        failed: 0,
        items: [],
      });
      await nextTick();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('success');

      wrapper.unmount();
    });

    it('coerces missing total/succeeded/failed to 0', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-batch-update-completed', { batchId: 'batch-empty', items: [] });
      await nextTick();

      const newToasts = toast.toasts.value.slice(before);
      expect(newToasts).toHaveLength(1);
      expect(newToasts[0].tone).toBe('success');

      wrapper.unmount();
    });

    it('ignores events with no detail', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      globalThis.dispatchEvent(new Event('dd:sse-batch-update-completed'));
      await nextTick();

      expect(toast.toasts.value.slice(before)).toHaveLength(0);

      wrapper.unmount();
    });
  });

  describe('lifecycle', () => {
    it('removes listeners and cancels pending timers on unmount', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        containerName: 'nginx',
        operationId: 'op-pending',
        batchId: null,
      });
      // Unmount before the settle delay completes.
      wrapper.unmount();
      await settle();

      // The pending toast must have been cancelled.
      expect(toast.toasts.value.slice(before)).toHaveLength(0);

      // Subsequent events must be ignored after unmount.
      dispatch('dd:sse-update-applied', {
        containerName: 'redis',
        operationId: 'op-after-unmount',
        batchId: null,
      });
      await settle();
      expect(toast.toasts.value.slice(before)).toHaveLength(0);
    });
  });
});
