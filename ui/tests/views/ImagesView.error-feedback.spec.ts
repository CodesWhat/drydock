import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { computed } from 'vue';
import { i18n, setI18nLocale } from '@/boot/i18n';
import { resetPreferences } from '@/preferences/store';
import { getImages, getPrunePreview, pruneImages } from '@/services/images';
import { ApiError } from '@/utils/error';
import ImagesView from '@/views/ImagesView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/composables/useServerFeatures', () => ({
  useServerFeatures: () => ({ containerActionsEnabled: computed(() => true) }),
}));
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ require: mocks.confirm }),
}));
vi.mock('@/composables/useToast', () => ({ useToast: () => mocks.toast }));

const operations = [
  { key: 'imagesView.loadFailed', call: () => getImages(), method: 'GET' },
  {
    key: 'imagesView.prune.previewLoadFailed',
    call: () => getPrunePreview({ host: 'edge 1', mode: 'unused' }),
    method: 'GET',
  },
  {
    key: 'imagesView.prune.requestFailed',
    call: () => pruneImages({ host: 'edge 1', mode: 'unused' }),
    method: 'POST',
  },
] as const;

function failure(body: string, status = 503, contentType = 'application/json', statusText = '') {
  return new Response(body, { status, statusText, headers: { 'Content-Type': contentType } });
}

describe('Images error feedback through real HTTP services', () => {
  let wrapper: VueWrapper | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    setI18nLocale('en');
    vi.unstubAllGlobals();
  });

  describe.each(['fr', 'ar'] as const)('%s', (locale) => {
    beforeEach(() => setI18nLocale(locale));

    it.each(operations)(
      'localizes $key without losing HTTP diagnostics',
      async ({ key, call, method }) => {
        for (const body of ['null', '{}', '{"error":null}', '{"error":"  "}', '{broken']) {
          fetchMock.mockResolvedValueOnce(
            failure(body, 503, 'application/json', 'Service Unavailable'),
          );
          const error = await call().catch((cause: unknown) => cause);
          expect(i18n.global.te(key, locale)).toBe(true);
          expect(error).toBeInstanceOf(ApiError);
          expect(error).toMatchObject({
            status: 503,
            message: `${i18n.global.t(key)} (HTTP 503): Service Unavailable`,
          });
          expect(fetchMock.mock.lastCall?.[1]).toMatchObject({ credentials: 'include' });
          expect(fetchMock.mock.lastCall?.[1].method ?? 'GET').toBe(method);
        }
        expect(fetchMock).toHaveBeenCalledTimes(5);
      },
    );

    it.each(operations)(
      'handles HTML errors and empty reason phrases for $key',
      async ({ key, call }) => {
        fetchMock.mockResolvedValueOnce(failure('<html>unavailable</html>', 502, 'text/html'));
        await expect(call()).rejects.toMatchObject({
          status: 502,
          message: `${i18n.global.t(key)} (HTTP 502)`,
        });
      },
    );

    it('renders localized list failure and clears it on explicit same-mount refresh', async () => {
      fetchMock
        .mockResolvedValueOnce(failure('null'))
        .mockResolvedValueOnce(Response.json({ data: [], hosts: [] }));
      wrapper = mount(ImagesView, { global: { stubs: { ...dataViewStubs, AppIcon: true } } });
      await flushPromises();
      expect(wrapper.text()).toContain(`${i18n.global.t('imagesView.loadFailed')} (HTTP 503)`);
      const refresh = wrapper
        .findAll('button')
        .find((button) => button.text() === i18n.global.t('imagesView.refresh'));
      expect(refresh).toBeDefined();
      await refresh?.trigger('click');
      await flushPromises();
      expect(wrapper.text()).not.toContain('HTTP 503');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.every(([, options]) => !options.method)).toBe(true);
    });

    async function selectHost() {
      fetchMock.mockResolvedValueOnce(
        Response.json({ data: [], hosts: [{ id: 'edge 1', name: 'edge', supported: true }] }),
      );
      wrapper = mount(ImagesView, { global: { stubs: { ...dataViewStubs, AppIcon: true } } });
      await flushPromises();
      await wrapper.get('select').setValue('edge 1');
      return wrapper;
    }

    async function clickPrune(view: VueWrapper) {
      const button = view
        .findAll('button')
        .find((entry) => entry.text() === i18n.global.t('imagesView.prune.unused'));
      expect(button).toBeDefined();
      await button?.trigger('click');
      await flushPromises();
    }

    it('shows localized preview failure without offering confirmation or sending a prune', async () => {
      const view = await selectHost();
      fetchMock.mockResolvedValueOnce(failure('null'));
      await clickPrune(view);
      expect(mocks.toast.error).toHaveBeenCalledWith(
        i18n.global.t('imagesView.prune.failed', {
          host: 'Edge',
          message: `${i18n.global.t('imagesView.prune.previewLoadFailed')} (HTTP 503)`,
        }),
      );
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.every(([, options]) => !options.method)).toBe(true);
      expect(view.get<HTMLSelectElement>('select').element.value).toBe('edge 1');
    });

    it('keeps confirmation and reports localized prune failure without retrying the write', async () => {
      const view = await selectHost();
      fetchMock.mockResolvedValueOnce(
        Response.json({ host: 'edge 1', mode: 'unused', images: 2, reclaimable: 2048 }),
      );
      await clickPrune(view);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mocks.confirm).toHaveBeenCalledTimes(1);
      fetchMock.mockResolvedValueOnce(failure('null'));
      await mocks.confirm.mock.calls[0][0].accept();
      await flushPromises();
      expect(mocks.toast.error).toHaveBeenCalledWith(
        i18n.global.t('imagesView.prune.failed', {
          host: 'Edge',
          message: `${i18n.global.t('imagesView.prune.requestFailed')} (HTTP 503)`,
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.lastCall).toEqual([
        '/api/v1/images/prune',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-DD-Confirm-Action': 'image-prune' },
          body: JSON.stringify({ host: 'edge 1', mode: 'unused' }),
        },
      ]);
      expect(view.get<HTMLSelectElement>('select').element.value).toBe('edge 1');
    });

    it('retains the 504 warning and refreshes inventory instead of retrying a prune', async () => {
      const view = await selectHost();
      fetchMock.mockResolvedValueOnce(
        Response.json({ host: 'edge 1', mode: 'unused', images: 2, reclaimable: 2048 }),
      );
      await clickPrune(view);
      fetchMock
        .mockResolvedValueOnce(failure('null', 504))
        .mockResolvedValueOnce(Response.json({ data: [], hosts: [] }));
      await mocks.confirm.mock.calls[0][0].accept();
      await flushPromises();
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        i18n.global.t('imagesView.prune.stillRunning', { host: 'Edge' }),
      );
      expect(mocks.toast.error).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(
        1,
      );
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  it.each(operations)('preserves server and network diagnostics for $key', async ({ call }) => {
    fetchMock.mockResolvedValueOnce(failure('{"error":"  busy  "}', 409));
    await expect(call()).rejects.toMatchObject({ status: 409, message: '  busy  ' });
    const networkError = new Error('connection reset');
    fetchMock.mockRejectedValueOnce(networkError);
    await expect(call()).rejects.toBe(networkError);
  });

  it('has every fallback key in every supported locale', () => {
    for (const locale of i18n.global.availableLocales) {
      for (const { key } of operations)
        expect(i18n.global.te(key, locale), `${locale}:${key}`).toBe(true);
    }
  });
});
