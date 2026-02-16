import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { useLogViewport } from '@/composables/useLogViewerBehavior';

const LogViewportHarness = defineComponent({
  template: '<div />',
  setup() {
    return useLogViewport();
  },
});

describe('useLogViewerBehavior', () => {
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
