import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { i18n, setI18nLocale } from '@/boot/i18n';
import AppLogViewer from '@/components/AppLogViewer.vue';
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
    setI18nLocale('en');
  });

  it.each([
    ['ar', 'متوقف مؤقتًا', 'غير متصل'],
    ['de', 'Pausiert', 'Nicht verbunden'],
    ['it', 'In pausa', 'Non in linea'],
    ['ja', '一時停止中', 'オフライン'],
    ['ko', '일시 중지됨', '오프라인'],
    ['nl', 'Gepauzeerd', 'Niet verbonden'],
    ['pl', 'Wstrzymano', 'Brak połączenia'],
    ['pt-BR', 'Pausado', 'Desconectado'],
    ['ru', 'Приостановлено', 'Не в сети'],
    ['tr', 'Duraklatıldı', 'Çevrimdışı'],
    ['uk', 'Призупинено', 'Не в мережі'],
    ['vi', 'Đã tạm dừng', 'Ngoại tuyến'],
    ['zh-TW', '已暫停', '離線'],
  ] as const)(
    'updates log state captions in %s without changing log data or streaming',
    async (locale, paused, offline) => {
      const line = 'Paused Offline Unknown User';
      const wrapper = mount(ConfigLogsTab, {
        props: {
          ...baseProps,
          entries: [
            {
              id: 1,
              timestamp: '2026-09-19T00:00:00Z',
              line,
              plainLine: line,
              ansiSegments: [{ text: line, color: null, bold: false, dim: false }],
              json: null,
              component: 'Offline',
            },
          ],
        },
        global: { stubs: { AppIcon: true } },
      });
      try {
        const viewer = wrapper.getComponent(AppLogViewer);
        const status = () =>
          viewer
            .get('[data-test="container-log-line-count"]')
            .element.parentElement?.nextElementSibling?.textContent?.trim();
        expect(status()).toBe('Paused');
        setI18nLocale(locale);
        await nextTick();
        expect.soft(status()).toBe(paused);
        expect(viewer.props('paused')).toBe(true);
        await wrapper.setProps({ streamingEnabled: true });
        expect.soft(status()).toBe(offline);
        expect(viewer.props('paused')).toBe(false);
        await wrapper.setProps({ streamingConnected: true });
        expect(status()).toBe(i18n.global.t('configView.logs.toolbar.live'));
        expect(viewer.text()).toContain(line);
        expect(viewer.props('entries')[0].component).toBe('Offline');
        expect(wrapper.emitted('toggle-pause')).toBeUndefined();
        expect(wrapper.emitted('update:streamingEnabled')).toBeUndefined();
        expect(wrapper.emitted('retry')).toBeUndefined();
      } finally {
        wrapper.unmount();
        setI18nLocale('en');
      }
    },
  );

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

  it.each([
    { loading: false, error: '', streamingEnabled: false },
    { loading: true, error: 'Unavailable', streamingEnabled: false },
    { loading: false, error: 'Unavailable', streamingEnabled: true },
  ])('does not offer retry outside a settled paused error: %o', (state) => {
    const wrapper = mount(ConfigLogsTab, {
      props: { ...baseProps, ...state },
      global: { stubs: { AppLogViewer: AppLogViewerStub, AppIcon: true } },
    });
    expect(wrapper.findComponent({ name: 'AppButton' }).exists()).toBe(false);
    wrapper.unmount();
  });
});
