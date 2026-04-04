import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import ConfigLogsTab from '@/components/config/ConfigLogsTab.vue';
import { preferences, resetPreferences } from '@/preferences/store';

const AppLogViewerStub = defineComponent({
  props: {
    newestFirst: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['update:newestFirst'],
  template:
    '<button data-test="app-log-viewer-stub" @click="$emit(\'update:newestFirst\', !newestFirst)"><slot /></button>',
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
  beforeEach(() => {
    localStorage.clear();
    resetPreferences();
  });

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

  it('binds the shared log sort preference into AppLogViewer', async () => {
    preferences.views.logs.newestFirst = true;

    const wrapper = mount(ConfigLogsTab, {
      props: baseProps,
      global: {
        stubs: {
          AppLogViewer: AppLogViewerStub,
          AppIcon: true,
        },
      },
    });

    const viewer = wrapper.getComponent(AppLogViewerStub);
    expect(viewer.props('newestFirst')).toBe(true);

    await viewer.trigger('click');

    expect(preferences.views.logs.newestFirst).toBe(false);
  });
});
