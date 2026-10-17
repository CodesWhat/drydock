import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, ref } from 'vue';
import { i18n } from '@/boot/i18n';
import { useContainerPreview } from '@/views/containers/useContainerPreview';

describe('preview HTTP failure presentation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    i18n.global.locale.value = 'en';
    vi.unstubAllGlobals();
  });
  it.each(['fr', 'ar'] as const)(
    'shows a localized %s failure and allows explicit recovery',
    async (locale) => {
      i18n.global.locale.value = locale;
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('upstream down', { status: 502 }))
        .mockResolvedValueOnce(Response.json({ dryRun: true }));
      const wrapper = mount(
        defineComponent({
          setup() {
            return useContainerPreview({ selectedContainerId: ref('c1') });
          },
          template:
            '<button :disabled="previewLoading" @click="runContainerPreview">Preview</button><p role="alert">{{ previewError }}</p>',
        }),
      );
      try {
        expect(fetch).not.toHaveBeenCalled();
        await wrapper.get('button').trigger('click');
        await flushPromises();
        expect(wrapper.get('[role="alert"]').text()).toBe(
          `${i18n.global.t('containerComponents.preview.toasts.failedDetail')} (HTTP 502)`,
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
        await wrapper.get('button').trigger('click');
        await flushPromises();
        expect(wrapper.get('[role="alert"]').text()).toBe('');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenLastCalledWith('/api/v1/containers/c1/preview', {
          method: 'POST',
          credentials: 'include',
        });
      } finally {
        wrapper.unmount();
      }
    },
  );
});
