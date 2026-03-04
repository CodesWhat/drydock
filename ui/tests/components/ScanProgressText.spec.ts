import { mount } from '@vue/test-utils';
import ScanProgressText from '@/components/ScanProgressText.vue';

describe('ScanProgressText', () => {
  it('renders scan progress text', () => {
    const wrapper = mount(ScanProgressText, {
      props: {
        progress: {
          done: 2,
          total: 7,
        },
      },
    });

    expect(wrapper.text()).toContain('Scanning 2/7...');
  });

  it('updates text when progress changes', async () => {
    const wrapper = mount(ScanProgressText, {
      props: {
        progress: {
          done: 0,
          total: 1,
        },
      },
    });

    expect(wrapper.text()).toContain('Scanning 0/1...');

    await wrapper.setProps({
      progress: {
        done: 1,
        total: 1,
      },
    });

    expect(wrapper.text()).toContain('Scanning 1/1...');
  });
});
