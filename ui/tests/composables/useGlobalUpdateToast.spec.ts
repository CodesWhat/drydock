import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import {
  UPDATE_TOAST_FALLBACK_DELAY_MS,
  useGlobalUpdateToast,
} from '@/composables/useGlobalUpdateToast';
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
  // Advance past the fallback safety timer so the toast fires even when no
  // container-state event is dispatched in the test.
  await vi.advanceTimersByTimeAsync(UPDATE_TOAST_FALLBACK_DELAY_MS);
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

    it('fires immediately on a matching container-state event without waiting for fallback', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        operationId: 'op-settle-id',
        containerId: 'c-settle-1',
        containerName: 'nginx',
        batchId: null,
      });
      await nextTick();
      // Toast not yet fired — waiting for the row-settle event.
      expect(toast.toasts.value.slice(before)).toHaveLength(0);

      // Container-updated event for the same container id arrives → toast fires.
      dispatch('dd:sse-container-updated', { id: 'c-settle-1', name: 'nginx' });
      await nextTick();

      expect(toast.toasts.value.slice(before)).toHaveLength(1);
      expect(toast.toasts.value.slice(before)[0]).toMatchObject({
        tone: 'success',
        title: 'Updated: nginx',
      });

      wrapper.unmount();
    });

    it('matches a settle event by newContainerId when the container is recreated', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        operationId: 'op-recreate',
        containerId: 'c-old',
        newContainerId: 'c-new',
        containerName: 'nginx',
        batchId: null,
      });
      await nextTick();

      dispatch('dd:sse-container-added', { id: 'c-new', name: 'nginx' });
      await nextTick();

      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      wrapper.unmount();
    });

    it('does not double-fire when the fallback timer expires after a settle event', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        operationId: 'op-settle-then-timer',
        containerId: 'c-st',
        containerName: 'nginx',
        batchId: null,
      });
      await nextTick();

      dispatch('dd:sse-container-updated', { id: 'c-st', name: 'nginx' });
      await nextTick();
      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      // Fallback timer expires later — should be a no-op since entry is gone.
      await settle();
      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      wrapper.unmount();
    });

    it('handles a duplicate settle event for the same container as a no-op', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        operationId: 'op-double-settle',
        containerId: 'c-double',
        containerName: 'nginx',
        batchId: null,
      });
      await nextTick();

      dispatch('dd:sse-container-updated', { id: 'c-double', name: 'nginx' });
      dispatch('dd:sse-container-updated', { id: 'c-double', name: 'nginx' });
      await nextTick();

      // Toast fires once on the first settle; second settle is a no-op.
      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      wrapper.unmount();
    });

    it('matches a settle event by container name when no id matches', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        operationId: 'op-by-name',
        containerName: 'redis',
        batchId: null,
      });
      await nextTick();

      dispatch('dd:sse-container-updated', { name: 'redis' });
      await nextTick();

      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      wrapper.unmount();
    });

    it('ignores container-state events with neither id nor name', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        operationId: 'op-no-settle',
        containerId: 'c-1',
        containerName: 'nginx',
        batchId: null,
      });
      await nextTick();

      dispatch('dd:sse-container-updated', {});
      dispatch('dd:sse-container-updated', { id: 'unrelated' });
      await nextTick();
      expect(toast.toasts.value.slice(before)).toHaveLength(0);

      // Falls back to the timer.
      await settle();
      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      wrapper.unmount();
    });

    it('ignores container-state events with no detail at all', async () => {
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        operationId: 'op-no-detail',
        containerName: 'nginx',
        batchId: null,
      });
      await nextTick();

      globalThis.dispatchEvent(new Event('dd:sse-container-updated'));
      await nextTick();
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

    it('refuses a duplicate installation and logs an error', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const first = mountGlobalToast();

      // Second install must bail with an error log rather than register a
      // second set of listeners. If the guard failed, the next dispatch would
      // double-fire — so the assertion below also covers that.
      const second = mountGlobalToast();
      const myErrors = errorSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('useGlobalUpdateToast'),
      );
      expect(myErrors).toHaveLength(1);
      expect(myErrors[0][0]).toMatch(/already installed/i);

      const before = first.toast.toasts.value.length;
      dispatch('dd:sse-update-applied', {
        containerId: 'c-dup',
        containerName: 'nginx',
        operationId: 'op-dup',
        batchId: null,
      });
      await settle();
      expect(first.toast.toasts.value.slice(before)).toHaveLength(1);

      second.wrapper.unmount();
      first.wrapper.unmount();
      errorSpy.mockRestore();
    });

    it('allows reinstallation after the original scope disposes', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const first = mountGlobalToast();
      first.wrapper.unmount();

      // After dispose, the module-level `installed` flag resets, so a fresh
      // install on a new App.vue mount (e.g., after a hot reload) works
      // without an error log.
      const second = mountGlobalToast();
      const myErrors = errorSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('useGlobalUpdateToast'),
      );
      expect(myErrors).toHaveLength(0);

      second.wrapper.unmount();
      errorSpy.mockRestore();
    });

    it('evicts the oldest dedup entry once the cap is reached', async () => {
      const { wrapper } = mountGlobalToast();
      const store = useToastStore();
      const addSpy = vi.spyOn(store, 'add');

      // Fire the bookkeeping operationId first so it is the oldest in the map.
      dispatch('dd:sse-update-applied', {
        containerName: 'first',
        operationId: 'op-first',
        batchId: null,
      });
      await settle();
      expect(addSpy).toHaveBeenCalledTimes(1);

      // Fill the dedup map up to its cap with 500 more distinct operationIds.
      // After 500 of these (size briefly reaches 501 in flight), the cap check
      // evicts the oldest entry (`op-first`).
      for (let i = 0; i < 500; i += 1) {
        dispatch('dd:sse-update-applied', {
          containerName: `c-${i}`,
          operationId: `op-fill-${i}`,
          batchId: null,
        });
      }
      await settle();
      expect(addSpy).toHaveBeenCalledTimes(501);

      // Replay `op-first`. If it had still been in the dedup map this would
      // be suppressed; eviction must allow it to fire again.
      dispatch('dd:sse-update-applied', {
        containerName: 'first',
        operationId: 'op-first',
        batchId: null,
      });
      await settle();
      expect(addSpy).toHaveBeenCalledTimes(502);

      wrapper.unmount();
    });

    it('does not silently swallow a failed event after applied for the same operationId', async () => {
      // The dedup map keys by event kind ("applied" vs "failed") so an out-of-
      // order replay where applied lands first must not block the subsequent
      // failed event for the same operationId from firing its own toast.
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      const detail = {
        containerId: 'c-race',
        containerName: 'nginx',
        operationId: 'op-applied-then-failed',
        batchId: null,
      };

      dispatch('dd:sse-update-applied', detail);
      await settle();
      const afterApplied = toast.toasts.value.slice(before);
      expect(afterApplied).toHaveLength(1);
      expect(afterApplied[0]).toMatchObject({ tone: 'success', title: 'Updated: nginx' });

      dispatch('dd:sse-update-failed', { ...detail, error: 'pull failed' });
      await settle();

      const allNew = toast.toasts.value.slice(before);
      expect(allNew).toHaveLength(2);
      expect(allNew[1]).toMatchObject({ tone: 'error' });
      expect(allNew[1].title).toContain('nginx');

      wrapper.unmount();
    });

    it('does not silently swallow an applied event after failed for the same operationId', async () => {
      // Mirror of the previous case for the reverse race ordering.
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      const detail = {
        containerId: 'c-race-2',
        containerName: 'redis',
        operationId: 'op-failed-then-applied',
        batchId: null,
      };

      dispatch('dd:sse-update-failed', { ...detail, error: 'transient' });
      await settle();
      expect(toast.toasts.value.slice(before)).toHaveLength(1);

      dispatch('dd:sse-update-applied', detail);
      await settle();

      const allNew = toast.toasts.value.slice(before);
      expect(allNew).toHaveLength(2);
      expect(allNew[1]).toMatchObject({ tone: 'success', title: 'Updated: redis' });

      wrapper.unmount();
    });

    it('does not clobber anonymous (no operationId) pending toasts across different containers', async () => {
      // Two concurrent in-flight updates with no operationId — each gets a
      // distinct synthetic key. A settle event for one container must fire
      // only that container's toast, not both.
      const { wrapper, toast } = mountGlobalToast();
      const before = toast.toasts.value.length;

      dispatch('dd:sse-update-applied', {
        containerId: 'c-anon-1',
        containerName: 'nginx',
        batchId: null,
      });
      dispatch('dd:sse-update-applied', {
        containerId: 'c-anon-2',
        containerName: 'redis',
        batchId: null,
      });
      await nextTick();
      expect(toast.toasts.value.slice(before)).toHaveLength(0);

      dispatch('dd:sse-container-updated', { id: 'c-anon-1', name: 'nginx' });
      await nextTick();

      const fired = toast.toasts.value.slice(before);
      expect(fired).toHaveLength(1);
      expect(fired[0].title).toBe('Updated: nginx');

      // The redis toast must still be pending until its own settle event.
      dispatch('dd:sse-container-updated', { id: 'c-anon-2', name: 'redis' });
      await nextTick();
      const afterSecond = toast.toasts.value.slice(before);
      expect(afterSecond).toHaveLength(2);
      expect(afterSecond[1].title).toBe('Updated: redis');

      wrapper.unmount();
    });

    it('does not evict when the dedup map is below the cap', async () => {
      const { wrapper } = mountGlobalToast();
      const store = useToastStore();
      const addSpy = vi.spyOn(store, 'add');

      dispatch('dd:sse-update-applied', {
        containerName: 'first',
        operationId: 'op-first',
        batchId: null,
      });
      await settle();
      expect(addSpy).toHaveBeenCalledTimes(1);

      // Fill far below the cap; the oldest entry must NOT be evicted, so a
      // replay of `op-first` should still be deduplicated.
      for (let i = 0; i < 50; i += 1) {
        dispatch('dd:sse-update-applied', {
          containerName: `c-${i}`,
          operationId: `op-fill-${i}`,
          batchId: null,
        });
      }
      await settle();

      dispatch('dd:sse-update-applied', {
        containerName: 'first',
        operationId: 'op-first',
        batchId: null,
      });
      await settle();
      expect(addSpy).toHaveBeenCalledTimes(51);

      wrapper.unmount();
    });
  });
});
