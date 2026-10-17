import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import ConfigApiKeysTab from '@/components/config/ConfigApiKeysTab.vue';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { createApiKey, listApiKeys, revokeApiKey } from '@/services/api-key';

vi.mock('@/services/api-key', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api-key')>();
  return {
    ...actual,
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  };
});

const AppButtonStub = defineComponent({
  props: ['disabled'],
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

function record(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

/** One page of keys, as the service now returns it. */
function page(data: unknown[], overrides: Record<string, unknown> = {}) {
  return { data, total: data.length, hasMore: false, ...overrides } as never;
}

async function mountTab() {
  const wrapper = mount(ConfigApiKeysTab, {
    global: {
      stubs: {
        AppIcon: { template: '<span />' },
        AppButton: AppButtonStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

/**
 * Rows come from the shared DataTable, which owns its own markup and offers no
 * per-row hook, so rows are addressed by position. The component renders them
 * in the order the API returned them.
 */
function rowAt(wrapper: Awaited<ReturnType<typeof mountTab>>, index = 0) {
  return wrapper.findAll('tbody tr')[index];
}

/**
 * Matched on exact text: "Create" and "Create Key" are different buttons, and a
 * substring match silently clicks the header one.
 */
function buttonByText(wrapper: Awaited<ReturnType<typeof mountTab>>, text: string) {
  const button = wrapper.findAll('button').find((entry) => entry.text().trim() === text);
  if (!button) {
    throw new Error(`No button labelled "${text}"`);
  }
  return button;
}

beforeEach(() => {
  vi.mocked(listApiKeys).mockResolvedValue(page([]));
  vi.mocked(createApiKey).mockReset();
  vi.mocked(revokeApiKey).mockReset();
  useConfirmDialog().dismiss();
});

afterEach(() => {
  vi.mocked(listApiKeys).mockReset();
});

describe('ConfigApiKeysTab listing', () => {
  it('loads keys on mount', async () => {
    await mountTab();

    expect(listApiKeys).toHaveBeenCalledTimes(1);
  });

  it('renders a row per key with the truncated prefix rather than a credential', async () => {
    vi.mocked(listApiKeys).mockResolvedValue(page([record()]));

    const wrapper = await mountTab();

    const row = rowAt(wrapper);
    expect(row.text()).toContain('ddk_a1b2c3d4e5f6…');
    expect(row.text()).toContain('ci');
    expect(row.text()).toContain('read');
  });

  it('shows an empty state when there are no keys', async () => {
    const wrapper = await mountTab();

    expect(wrapper.text()).toContain('No API keys yet');
    expect(wrapper.find('table').exists()).toBe(false);
  });

  it('surfaces a load failure and renders no table', async () => {
    vi.mocked(listApiKeys).mockRejectedValue(new Error('nope'));

    const wrapper = await mountTab();

    expect(wrapper.text()).toContain('nope');
    expect(wrapper.find('table').exists()).toBe(false);
  });

  it('renders a never-expiring, never-used key as Never rather than blank', async () => {
    vi.mocked(listApiKeys).mockResolvedValue(page([record()]));

    const wrapper = await mountTab();

    expect(rowAt(wrapper).text()).toContain('Never');
  });

  it('formats a usable timestamp and passes an unparseable one through', async () => {
    vi.mocked(listApiKeys).mockResolvedValue(
      page([
        record({ keyId: 'aaaaaaaaaaaa', lastUsedAt: '2026-09-01T10:00:00.000Z' }),
        record({ keyId: 'bbbbbbbbbbbb', expiresAt: 'soon-ish' }),
      ]),
    );

    const wrapper = await mountTab();

    expect(rowAt(wrapper, 0).text()).not.toContain('2026-09-01T10:00:00.000Z');
    expect(rowAt(wrapper, 1).text()).toContain('soon-ish');
  });

  it.each([
    ['active', 'Active'],
    ['expired', 'Expired'],
    ['revoked', 'Revoked'],
  ])('labels a %s key', async (status, label) => {
    vi.mocked(listApiKeys).mockResolvedValue(page([record({ status })]));

    const wrapper = await mountTab();

    expect(rowAt(wrapper).text()).toContain(label);
  });

  it('offers no revoke button on an already-revoked key', async () => {
    vi.mocked(listApiKeys).mockResolvedValue(page([record({ status: 'revoked' })]));

    const wrapper = await mountTab();

    expect(
      rowAt(wrapper)
        .findAll('button')
        .map((button) => button.text()),
    ).toStrictEqual([]);
  });
});

describe('ConfigApiKeysTab creation', () => {
  async function openForm() {
    const wrapper = await mountTab();
    await buttonByText(wrapper, 'Create Key').trigger('click');
    return wrapper;
  }

  it('offers every scope the API enforces', async () => {
    const wrapper = await openForm();

    const values = wrapper
      .findAll('input[type="checkbox"]')
      .map((input) => input.attributes('value'));
    expect(values).toStrictEqual([
      'read',
      'containers:watch',
      'containers:update',
      'triggers:test',
      'admin',
      'api-keys:manage',
    ]);
  });

  it('refuses to submit without a name', async () => {
    const wrapper = await openForm();

    expect(buttonByText(wrapper, 'Create').attributes('disabled')).toBeDefined();
  });

  it('refuses to submit with no scope selected', async () => {
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');
    await wrapper.get('input[type="checkbox"]').setValue(false);

    expect(buttonByText(wrapper, 'Create').attributes('disabled')).toBeDefined();
  });

  it('re-selects a scope that was toggled off and on', async () => {
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');
    const readScope = wrapper.get('input[type="checkbox"]');
    await readScope.setValue(false);
    await readScope.setValue(true);

    expect(buttonByText(wrapper, 'Create').attributes('disabled')).toBeUndefined();
  });

  it('sends the trimmed name, the selected scopes and a null expiry', async () => {
    vi.mocked(createApiKey).mockResolvedValue({
      ...record(),
      apiKey: `ddk_a1b2c3d4e5f6_${'A'.repeat(43)}`,
    } as never);
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('  ci  ');

    await buttonByText(wrapper, 'Create').trigger('click');
    await flushPromises();

    expect(createApiKey).toHaveBeenCalledWith({
      name: 'ci',
      scopes: ['read'],
      expiresAt: null,
    });
  });

  it('sends an expiry and a rate limit when supplied', async () => {
    vi.mocked(createApiKey).mockResolvedValue({ ...record(), apiKey: 'ddk_x' } as never);
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');
    await wrapper.get('input[type="date"]').setValue('2027-01-01');
    await wrapper.get('input[type="number"]').setValue('25');

    await buttonByText(wrapper, 'Create').trigger('click');
    await flushPromises();

    expect(vi.mocked(createApiKey).mock.calls[0][0]).toMatchObject({
      rateLimitMax: 25,
      expiresAt: new Date('2027-01-01').toISOString(),
    });
  });

  it('ignores a non-positive rate limit rather than sending it', async () => {
    vi.mocked(createApiKey).mockResolvedValue({ ...record(), apiKey: 'ddk_x' } as never);
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');
    await wrapper.get('input[type="number"]').setValue('0');

    await buttonByText(wrapper, 'Create').trigger('click');
    await flushPromises();

    expect(vi.mocked(createApiKey).mock.calls[0][0]).not.toHaveProperty('rateLimitMax');
  });

  it('reveals the credential once and reloads the list', async () => {
    const credential = `ddk_a1b2c3d4e5f6_${'A'.repeat(43)}`;
    vi.mocked(createApiKey).mockResolvedValue({ ...record(), apiKey: credential } as never);
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');

    await buttonByText(wrapper, 'Create').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="revealed-key"]').text()).toBe(credential);
    expect(listApiKeys).toHaveBeenCalledTimes(2);
  });

  it('clears a previous reveal when the form is reopened', async () => {
    vi.mocked(createApiKey).mockResolvedValue({ ...record(), apiKey: 'ddk_secret' } as never);
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');
    await buttonByText(wrapper, 'Create').trigger('click');
    await flushPromises();

    await buttonByText(wrapper, 'Create Key').trigger('click');

    expect(wrapper.find('[data-testid="revealed-key"]').exists()).toBe(false);
  });

  it('dismisses the reveal on request', async () => {
    vi.mocked(createApiKey).mockResolvedValue({ ...record(), apiKey: 'ddk_secret' } as never);
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');
    await buttonByText(wrapper, 'Create').trigger('click');
    await flushPromises();

    await buttonByText(wrapper, 'Close').trigger('click');

    expect(wrapper.find('[data-testid="revealed-key"]').exists()).toBe(false);
  });

  it('copies the credential to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.mocked(createApiKey).mockResolvedValue({ ...record(), apiKey: 'ddk_secret' } as never);
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');
    await buttonByText(wrapper, 'Create').trigger('click');
    await flushPromises();

    await buttonByText(wrapper, 'Copy').trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith('ddk_secret');
    expect(wrapper.text()).toContain('Copied');
    vi.unstubAllGlobals();
  });

  it('does not fail when the browser exposes no clipboard', async () => {
    vi.stubGlobal('navigator', {});
    vi.mocked(createApiKey).mockResolvedValue({ ...record(), apiKey: 'ddk_secret' } as never);
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');
    await buttonByText(wrapper, 'Create').trigger('click');
    await flushPromises();

    await buttonByText(wrapper, 'Copy').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Copied');
    vi.unstubAllGlobals();
  });

  it('surfaces a ceiling refusal without revealing anything', async () => {
    vi.mocked(createApiKey).mockRejectedValue(
      new Error('An API key cannot grant scopes it does not hold itself'),
    );
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');

    await buttonByText(wrapper, 'Create').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('An API key cannot grant scopes it does not hold itself');
    expect(wrapper.find('[data-testid="revealed-key"]').exists()).toBe(false);
  });

  it('closes the form and drops the entered name on cancel', async () => {
    const wrapper = await openForm();
    await wrapper.get('input[type="text"]').setValue('ci');

    await buttonByText(wrapper, 'Cancel').trigger('click');
    await buttonByText(wrapper, 'Create Key').trigger('click');

    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('');
  });
});

describe('ConfigApiKeysTab revocation', () => {
  async function mountWithKey(overrides: Record<string, unknown> = {}) {
    vi.mocked(listApiKeys).mockResolvedValue(page([record(overrides)]));
    const wrapper = await mountTab();
    await buttonByText(wrapper, 'Revoke').trigger('click');
    return wrapper;
  }

  it('asks for confirmation before revoking, naming the key', async () => {
    await mountWithKey({ name: 'deploy-bot' });

    const { visible, current } = useConfirmDialog();
    expect(visible.value).toBe(true);
    expect(current.value?.message).toContain('deploy-bot');
    expect(current.value?.severity).toBe('danger');
    expect(revokeApiKey).not.toHaveBeenCalled();
  });

  it('does not revoke when the confirmation is dismissed', async () => {
    await mountWithKey();

    useConfirmDialog().dismiss();
    await flushPromises();

    expect(revokeApiKey).not.toHaveBeenCalled();
  });

  it('revokes and reloads once accepted', async () => {
    vi.mocked(revokeApiKey).mockResolvedValue({
      keyId: 'a1b2c3d4e5f6',
      revokedKeyIds: ['a1b2c3d4e5f6'],
      cascadeCount: 1,
    });
    const wrapper = await mountWithKey();

    await useConfirmDialog().accept();
    await flushPromises();

    expect(revokeApiKey).toHaveBeenCalledWith('a1b2c3d4e5f6');
    expect(listApiKeys).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain('including every key this one created');
  });

  it('reports the cascade when the revocation took more than the named key', async () => {
    vi.mocked(revokeApiKey).mockResolvedValue({
      keyId: 'a1b2c3d4e5f6',
      revokedKeyIds: ['a1b2c3d4e5f6', 'b', 'c'],
      cascadeCount: 3,
    });
    const wrapper = await mountWithKey();

    await useConfirmDialog().accept();
    await flushPromises();

    expect(wrapper.text()).toContain('Revoked 3 keys');
  });

  it('surfaces a refusal to revoke', async () => {
    vi.mocked(revokeApiKey).mockRejectedValue(
      new Error('An API key cannot revoke the key that minted it'),
    );
    const wrapper = await mountWithKey();

    await useConfirmDialog().accept();
    await flushPromises();

    expect(wrapper.text()).toContain('An API key cannot revoke the key that minted it');
  });
});

describe('ConfigApiKeysTab paging', () => {
  function pageOf(count: number, start = 0, total = 120) {
    const more = start + count < total;
    return page(
      Array.from({ length: count }, (_unused, index) =>
        record({ keyId: `${start + index}`.padStart(12, '0'), name: `key-${start + index}` }),
      ),
      {
        total,
        hasMore: more,
        ...(more ? { nextCursor: `cursor-${start + count}` } : {}),
      },
    );
  }

  it('asks for the first page and reports the full total', async () => {
    vi.mocked(listApiKeys).mockResolvedValue(pageOf(50));

    const wrapper = await mountTab();

    expect(listApiKeys).toHaveBeenCalledWith({ limit: 50 });
    expect(wrapper.find('[data-testid="api-keys-count"]').text()).toContain('120');
    expect(wrapper.findAll('tbody tr')).toHaveLength(50);
  });

  it('appends the next page and keeps what was already loaded', async () => {
    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(50));
    const wrapper = await mountTab();

    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(50, 50));
    await buttonByText(wrapper, 'Load more').trigger('click');
    await flushPromises();

    // The cursor the first page handed back, not a count of what is on screen:
    // an offset shifts under a key minted while the operator is reading.
    expect(listApiKeys).toHaveBeenLastCalledWith({ cursor: 'cursor-50' });
    expect(wrapper.findAll('tbody tr')).toHaveLength(100);
    expect(wrapper.text()).toContain('key-0');
    expect(wrapper.text()).toContain('key-99');
  });

  it('walks on the cursor the server last handed back, page after page', async () => {
    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(50));
    const wrapper = await mountTab();

    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(50, 50));
    await buttonByText(wrapper, 'Load more').trigger('click');
    await flushPromises();

    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(20, 100));
    await buttonByText(wrapper, 'Load more').trigger('click');
    await flushPromises();

    expect(listApiKeys).toHaveBeenLastCalledWith({ cursor: 'cursor-100' });
    expect(wrapper.findAll('tbody tr')).toHaveLength(120);
  });

  it('does not page on when the server reports more but hands back no cursor', async () => {
    // Without a cursor there is nothing to ask for, and repeating the first
    // request would duplicate every row already on screen.
    vi.mocked(listApiKeys).mockResolvedValue(
      page([record({ keyId: '000000000000' })], { total: 9, hasMore: true }),
    );

    const wrapper = await mountTab();

    expect(wrapper.findAll('button').some((entry) => entry.text() === 'Load more')).toBe(false);
  });

  it('hides the control on the last page', async () => {
    vi.mocked(listApiKeys).mockResolvedValue(pageOf(20, 0, 20));

    const wrapper = await mountTab();

    expect(wrapper.findAll('button').some((entry) => entry.text() === 'Load more')).toBe(false);
  });

  it('surfaces a failure to load the next page without losing the rows on screen', async () => {
    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(50));
    const wrapper = await mountTab();

    vi.mocked(listApiKeys).mockRejectedValueOnce(new Error('gone'));
    await buttonByText(wrapper, 'Load more').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('gone');
    expect(wrapper.findAll('tbody tr')).toHaveLength(50);
  });

  it('reloads everything already on screen after a revocation', async () => {
    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(50));
    const wrapper = await mountTab();
    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(50, 50));
    await buttonByText(wrapper, 'Load more').trigger('click');
    await flushPromises();

    vi.mocked(revokeApiKey).mockResolvedValue({
      keyId: '000000000000',
      revokedKeyIds: ['000000000000'],
      cascadeCount: 1,
    });
    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(99, 0, 119));
    await buttonByText(wrapper, 'Revoke').trigger('click');
    useConfirmDialog().accept();
    await flushPromises();

    // Not back to the first 50: paging through and then revoking one key must
    // not collapse the table under the operator.
    expect(listApiKeys).toHaveBeenLastCalledWith({ limit: 100 });
  });

  it('never asks for more than the server will return in one page', async () => {
    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(200, 0, 400));
    const wrapper = await mountTab();
    vi.mocked(listApiKeys).mockResolvedValueOnce(pageOf(50, 200, 400));
    await buttonByText(wrapper, 'Load more').trigger('click');
    await flushPromises();

    await wrapper.vm.load();
    await flushPromises();

    expect(listApiKeys).toHaveBeenLastCalledWith({ limit: 200 });
  });
});
