import { flushPromises, mount } from '@vue/test-utils';
import { i18n } from '@/boot/i18n';
import ConfigApiKeysTab from '@/components/config/ConfigApiKeysTab.vue';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import type { ApiKey } from '@/services/api-key';

const record: ApiKey = {
  keyId: 'a1b2c3d4e5f6',
  name: 'ci',
  displayPrefix: 'ddk_a1b2c3d4e5f6…',
  scopes: ['read'],
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  createdBy: 'user:scott',
  parentKeyId: null,
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
};
const originalLocale = i18n.global.locale.value;
let wrapper: ReturnType<typeof mount<typeof ConfigApiKeysTab>>;

async function mountTab() {
  wrapper = mount(ConfigApiKeysTab, {
    global: { stubs: { AppIcon: { template: '<span />' } } },
  });
  await flushPromises();
}

function button(key: string) {
  const match = wrapper.findAll('button').find((entry) => entry.text() === i18n.global.t(key));
  if (!match) throw new Error(`Missing button: ${key}`);
  return match;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        data: [record],
        total: 2,
        nextCursor: 'next+page',
      }),
    ),
  );
  useConfirmDialog().dismiss();
});
afterEach(() => {
  wrapper?.unmount();
  useConfirmDialog().dismiss();
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(['fr', 'ar'] as const)('API key error display in %s', (locale) => {
  beforeEach(() => {
    i18n.global.locale.value = locale;
  });

  it('shows the localized load error from the real service', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>Unavailable</html>', { status: 502 }));
    await mountTab();

    expect(wrapper.text()).toContain(
      `${i18n.global.t('configView.apiKeys.errors.load')} (HTTP 502)`,
    );
    expect(wrapper.find('table').exists()).toBe(false);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/api-keys?limit=50', {
      credentials: 'include',
    });
  });

  it('keeps rows and the cursor when loading more fails', async () => {
    await mountTab();
    vi.mocked(fetch).mockResolvedValue(new Response('null', { status: 503 }));
    await button('configView.apiKeys.loadMore').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      `${i18n.global.t('configView.apiKeys.errors.load')} (HTTP 503)`,
    );
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.get('[data-testid="api-keys-count"]').text()).toBe(
      i18n.global.t('configView.apiKeys.showing', { shown: 1, total: 2 }),
    );
    expect(button('configView.apiKeys.loadMore').attributes('disabled')).toBeUndefined();
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/api-keys?limit=50&cursor=next%2Bpage', {
      credentials: 'include',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the create form without revealing a credential on a blank error', async () => {
    await mountTab();
    await button('configView.apiKeys.createButton').trigger('click');
    await wrapper.get('input[type="text"]').setValue('new key');
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: '  ' }, { status: 500 }));
    await button('configView.apiKeys.form.submit').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      `${i18n.global.t('configView.apiKeys.errors.create')} (HTTP 500)`,
    );
    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('new key');
    expect(wrapper.find('[data-testid="revealed-key"]').exists()).toBe(false);
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/api-keys', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new key', scopes: ['read'] }),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('requires confirmation and preserves the row when revoking fails', async () => {
    await mountTab();
    await button('configView.apiKeys.revokeButton').trigger('click');
    expect(fetch).toHaveBeenCalledTimes(1);
    useConfirmDialog().dismiss();
    expect(fetch).toHaveBeenCalledTimes(1);
    await button('configView.apiKeys.revokeButton').trigger('click');
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: '' }, { status: 502 }));
    await useConfirmDialog().accept();
    await flushPromises();

    expect(wrapper.text()).toContain(
      `${i18n.global.t('configView.apiKeys.errors.revoke')} (HTTP 502)`,
    );
    expect(wrapper.get('tbody tr').text()).toContain('ci');
    expect(fetch).toHaveBeenLastCalledWith(`/api/v1/api-keys/${record.keyId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'X-DD-Confirm-Action': 'api-key-revoke' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
