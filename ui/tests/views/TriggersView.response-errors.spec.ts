import { flushPromises } from '@vue/test-utils';
import { i18n } from '@/boot/i18n';
import TriggersView from '@/views/TriggersView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));

const originalLocale = i18n.global.locale.value;
const trigger = {
  id: 'http.alerts',
  name: 'alerts',
  type: 'http',
  agent: 'edge east',
  configuration: {},
};
let wrapper: ReturnType<typeof mountWithPlugins> | undefined;

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  i18n.global.locale.value = originalLocale;
});

describe.each(['fr', 'ar'] as const)('trigger test response in %s', (locale) => {
  it('shows the localized null-response failure and permits only an explicit new test', async () => {
    i18n.global.locale.value = locale;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json(null, { status: 502 });
      return Response.json(String(_url) === '/api/v1/triggers' ? [trigger] : trigger);
    });
    vi.stubGlobal('fetch', fetchMock);
    wrapper = mountWithPlugins(TriggersView, { global: { stubs: dataViewStubs } });
    await flushPromises();
    await wrapper.get('.row-click-first').trigger('click');
    await flushPromises();
    const button = wrapper.get('.detail-content .pt-2 button');
    await button.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      `${i18n.global.t('triggersView.test.defaultError')} (HTTP 502)`,
    );
    expect(wrapper.text()).not.toContain('Cannot read properties');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(button.attributes('disabled')).toBeUndefined();

    fetchMock.mockResolvedValueOnce(Response.json({ success: true }));
    await button.trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('(HTTP 502)');
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual(posts[1]);
    expect(posts[0][0]).toBe('/api/v1/triggers/http/alerts/edge%20east');
    expect(button.find('[data-icon="check"]').exists()).toBe(true);
  });
});
