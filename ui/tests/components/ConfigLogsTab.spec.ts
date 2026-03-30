import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import ConfigLogsTab from '@/components/config/ConfigLogsTab.vue';

const AppLogViewerStub = defineComponent({
  template: '<div data-test="app-log-viewer-stub"><slot /></div>',
});

const baseProps = {
  logLevel: 'info',
  entries: [],
  loading: false,
  error: '',
  logLevelFilter: 'all',
  tail: 100,
  componentFilter: '',
};

describe('ConfigLogsTab', () => {
  it('constrains log viewer height so scrolling stays inside the card', () => {
    const wrapper = mount(ConfigLogsTab, {
      props: baseProps,
      global: {
        stubs: {
          AppLogViewer: AppLogViewerStub,
          AppIcon: true,
        },
      },
    });

    const viewer = wrapper.get('[data-test="app-log-viewer-stub"]');
    expect(viewer.classes()).toContain('flex-1');
    expect(viewer.classes()).toContain('min-h-0');
  });
});
