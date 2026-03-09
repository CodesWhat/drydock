import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import ConfigLogsTab from '@/components/config/ConfigLogsTab.vue';

const LogViewerStub = defineComponent({
  template: '<div data-test="log-viewer-stub"><slot /></div>',
});

const baseProps = {
  logLevel: 'info',
  entries: [],
  loading: false,
  error: '',
  logLevelFilter: 'all',
  tail: 100,
  autoFetchInterval: 0,
  componentFilter: '',
  autoFetchOptions: [
    { value: 0, label: 'Off' },
    { value: 5000, label: '5s' },
  ],
  scrollBlocked: false,
  lastFetchedIso: '',
  formatLastFetched: () => 'never',
  formatTimestamp: () => 'timestamp',
  messageForEntry: () => '',
  levelColor: () => 'var(--dd-info)',
};

describe('ConfigLogsTab', () => {
  it('constrains log viewer height so scrolling stays inside the card', () => {
    const wrapper = mount(ConfigLogsTab, {
      props: baseProps,
      global: {
        stubs: {
          LogViewer: LogViewerStub,
          AppIcon: true,
        },
      },
    });

    const viewer = wrapper.get('[data-test="log-viewer-stub"]');
    expect(viewer.classes()).toContain('flex-1');
    expect(viewer.classes()).toContain('min-h-0');
  });
});
