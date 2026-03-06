import { mount } from '@vue/test-utils';
import ScanProgressBanner from '@/components/ScanProgressBanner.vue';

describe('ScanProgressBanner', () => {
  function factory(done = 0, total = 0) {
    return mount(ScanProgressBanner, {
      props: {
        progress: {
          done,
          total,
        },
      },
      global: {
        stubs: {
          AppIcon: true,
        },
      },
    });
  }

  it('renders scan progress copy with done and total values', () => {
    const wrapper = factory(2, 5);

    expect(wrapper.text()).toContain('Scanning 2/5 containers...');
  });

  it('renders proportional progress width when total is greater than zero', () => {
    const wrapper = factory(1, 4);

    const progressFill = wrapper.find('div.h-full.dd-rounded.transition-all.duration-300');
    expect(progressFill.exists()).toBe(true);
    expect(progressFill.attributes('style')).toContain('width: 25%');
  });

  it('renders zero-width progress when total is zero', () => {
    const wrapper = factory(3, 0);

    const progressFill = wrapper.find('div.h-full.dd-rounded.transition-all.duration-300');
    expect(progressFill.exists()).toBe(true);
    expect(progressFill.attributes('style')).toContain('width: 0%');
  });
});
