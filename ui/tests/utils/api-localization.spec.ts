import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, onMounted, ref } from 'vue';
import { i18n } from '@/boot/i18n';
import { SUPPORTED_LOCALES } from '@/i18n/locales';
import { getBackups } from '@/services/backup';
import { readJsonResponse } from '@/utils/api';
import { loadContainerDetailListState } from '@/views/containers/loadContainerDetailListState';

describe('JSON response error localization', () => {
  const originalLocale = i18n.global.locale.value;

  afterEach(() => {
    i18n.global.locale.value = originalLocale;
    vi.unstubAllGlobals();
  });

  it.each([
    ['<html>private proxy page</html>', 'text/html', 'API a renvoyé du HTML au lieu de JSON.'],
    ['not-json', 'application/json', 'API a renvoyé du JSON invalide.'],
    ['plain text', 'text/plain', 'API a renvoyé text/plain au lieu de JSON.'],
  ])('renders the localized backup diagnostic for %s', async (body, contentType, expected) => {
    i18n.global.locale.value = 'fr';
    const fetchResponse = vi
      .fn()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': contentType } }));
    vi.stubGlobal('fetch', fetchResponse);
    const Backups = defineComponent({
      setup() {
        const error = ref<string | null>(null);
        onMounted(() =>
          loadContainerDetailListState({
            containerId: 'container-a',
            loading: ref(false),
            error,
            value: ref([]),
            loader: getBackups,
            failureMessage: 'Impossible de charger les backups',
          }),
        );
        return () => h('p', { role: 'alert' }, error.value);
      },
    });
    const wrapper = mount(Backups);
    try {
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toContain(expected);
      expect(wrapper.text()).not.toContain('private proxy page');
      expect(wrapper.text()).not.toContain('returned');
      expect(fetchResponse).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/containers/container-a/backups',
        { credentials: 'include' },
      );
    } finally {
      wrapper.unmount();
    }
  });

  it('uses the current locale for each request and preserves the caller context', async () => {
    i18n.global.locale.value = 'en';
    await expect(readJsonResponse(new Response('{'), 'Inventory API')).rejects.toThrow(
      'Inventory API returned text/plain;charset=UTF-8 instead of JSON.',
    );
    i18n.global.locale.value = 'fr';
    await expect(
      readJsonResponse(
        new Response('{', { headers: { 'content-type': 'application/json' } }),
        'Inventory API',
      ),
    ).rejects.toThrow('Inventory API a renvoyé du JSON invalide.');
  });

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))(
    'provides non-English parser messages in %s',
    async (locale) => {
      i18n.global.locale.value = locale;
      for (const [key, contentType] of [
        ['invalidJson', 'application/json'],
        ['html', 'text/html'],
        ['contentType', 'text/plain'],
      ]) {
        const message = i18n.global.t(`common.apiResponse.${key}`, {
          context: 'API',
          contentType,
        });
        expect(message).toContain('API');
        expect(message).not.toContain('common.apiResponse');
        expect(message).not.toContain('returned');
        await expect(
          readJsonResponse(new Response('{', { headers: { 'content-type': contentType } })),
        ).rejects.toThrow(message);
      }
    },
  );

  it('preserves successful vendor JSON and non-syntax diagnostics', async () => {
    i18n.global.locale.value = 'fr';
    await expect(
      readJsonResponse(
        new Response('{"data":[{"id":"backup-a"}]}', {
          headers: { 'content-type': 'application/vnd.drydock+json; charset=utf-8' },
        }),
      ),
    ).resolves.toEqual({ data: [{ id: 'backup-a' }] });
    const failure = new TypeError('body stream disconnected');
    const response = new Response('{}', { headers: { 'content-type': 'application/json' } });
    vi.spyOn(response, 'json').mockRejectedValue(failure);
    await expect(readJsonResponse(response)).rejects.toBe(failure);
  });
});
