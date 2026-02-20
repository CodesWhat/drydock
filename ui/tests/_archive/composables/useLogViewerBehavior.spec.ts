import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { useAutoFetchLogs, useLogViewport } from '@/composables/useLogViewerBehavior';

const LogViewportHarness = defineComponent({
  template: '<div />',
  setup() {
    return useLogViewport();
  },
});

function mountAutoFetchHarness(initialInterval = 5, initialLoading = false) {
  const fetchLogs = vi.fn(async () => {});
  const AutoFetchHarness = defineComponent({
    template: '<div />',
    setup() {
      const intervalSeconds = ref(initialInterval);
      const loading = ref(initialLoading);
      const { startAutoFetch, stopAutoFetch } = useAutoFetchLogs({
        intervalSeconds,
        loading,
        fetchLogs,
      });
      return {
        intervalSeconds,
        loading,
        startAutoFetch,
        stopAutoFetch,
      };
    },
  });

  return {
    wrapper: mount(AutoFetchHarness),
    fetchLogs,
  };
}

describe('useLogViewerBehavior', () => {
  describe('useLogViewport', () => {
    it('handleLogScroll is a no-op when no log element is attached', () => {
      const wrapper = mount(LogViewportHarness);

      wrapper.vm.scrollBlocked = true;
      wrapper.vm.handleLogScroll();

      expect(wrapper.vm.scrollBlocked).toBe(true);
      wrapper.unmount();
    });

    it('resumeAutoScroll clears scroll lock even when no log element is attached', () => {
      const wrapper = mount(LogViewportHarness);

      wrapper.vm.scrollBlocked = true;
      wrapper.vm.resumeAutoScroll();

      expect(wrapper.vm.scrollBlocked).toBe(false);
      wrapper.unmount();
    });
  });

  describe('useAutoFetchLogs', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not start polling when interval is disabled', async () => {
      const { wrapper, fetchLogs } = mountAutoFetchHarness(0);

      wrapper.vm.startAutoFetch();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(fetchLogs).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('polls on the configured interval', async () => {
      const { wrapper, fetchLogs } = mountAutoFetchHarness(2);

      wrapper.vm.startAutoFetch();
      await vi.advanceTimersByTimeAsync(6_000);

      expect(fetchLogs).toHaveBeenCalledTimes(3);
      wrapper.unmount();
    });

    it('skips polling while loading is true', async () => {
      const { wrapper, fetchLogs } = mountAutoFetchHarness(2, true);

      wrapper.vm.startAutoFetch();
      await vi.advanceTimersByTimeAsync(4_000);
      expect(fetchLogs).not.toHaveBeenCalled();

      wrapper.vm.loading = false;
      await wrapper.vm.$nextTick();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(fetchLogs).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it('restarts polling when interval changes', async () => {
      const { wrapper, fetchLogs } = mountAutoFetchHarness(5);

      wrapper.vm.startAutoFetch();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetchLogs).toHaveBeenCalledTimes(1);

      wrapper.vm.intervalSeconds = 2;
      await wrapper.vm.$nextTick();
      await vi.advanceTimersByTimeAsync(4_000);

      expect(fetchLogs).toHaveBeenCalledTimes(3);
      wrapper.unmount();
    });

    it('stops polling when stopAutoFetch is called', async () => {
      const { wrapper, fetchLogs } = mountAutoFetchHarness(2);

      wrapper.vm.startAutoFetch();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fetchLogs).toHaveBeenCalledTimes(1);

      wrapper.vm.stopAutoFetch();
      await vi.advanceTimersByTimeAsync(4_000);
      expect(fetchLogs).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it('stops polling on unmount', async () => {
      const { wrapper, fetchLogs } = mountAutoFetchHarness(2);

      wrapper.vm.startAutoFetch();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fetchLogs).toHaveBeenCalledTimes(1);

      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(4_000);
      expect(fetchLogs).toHaveBeenCalledTimes(1);
    });
  });
});
