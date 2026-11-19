import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import AgentEdgeKeysPanel from '@/components/agents/AgentEdgeKeysPanel.vue';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { listPortwingKeys, registerPortwingKey, revokePortwingKey } from '@/services/portwing-key';
import { ApiError } from '@/utils/error';

vi.mock('@/services/portwing-key', () => ({
  listPortwingKeys: vi.fn(),
  registerPortwingKey: vi.fn(),
  revokePortwingKey: vi.fn(),
}));

const AppButtonStub = defineComponent({
  props: ['disabled'],
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const KEY = 'kPGd2xqT8vWzN4cRfYbLmJhQ5sUaE7nVwXyZ0AB1CdE='; // gitleaks:allow fake test public key
const active = {
  keyId: '3f8a1c2e9b047d56',
  pubkey: KEY,
  label: 'prod-agent',
  createdAt: '2026-05-01T09:00:00.000Z',
  revokedAt: null,
};
const revoked = {
  ...active,
  keyId: 'aaaaaaaaaaaaaaaa',
  label: 'old',
  revokedAt: '2026-05-02T00:00:00.000Z',
};

async function mountPanel() {
  const wrapper = mount(AgentEdgeKeysPanel, {
    global: { stubs: { AppIcon: { template: '<span />' }, AppButton: AppButtonStub } },
  });
  await flushPromises();
  return wrapper;
}

function button(wrapper: ReturnType<typeof mount>, text: string) {
  const match = wrapper.findAll('button').find((b) => b.text() === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

async function fillForm(wrapper: ReturnType<typeof mount>, label: string, pubkey: string) {
  await wrapper.find('input[type="text"]').setValue(label);
  await wrapper.find('textarea').setValue(pubkey);
}

beforeEach(() => {
  vi.mocked(listPortwingKeys).mockResolvedValue([active, revoked]);
  useConfirmDialog().dismiss();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  useConfirmDialog().dismiss();
});

describe('AgentEdgeKeysPanel', () => {
  it('lists keys with status and only offers revoke on active ones', async () => {
    const wrapper = await mountPanel();
    expect(wrapper.text()).toContain('prod-agent');
    expect(wrapper.text()).toContain(active.keyId);
    expect(wrapper.find(`[data-testid="edge-key-${active.keyId}"]`).text()).toContain('Active');
    expect(wrapper.find(`[data-testid="edge-key-${revoked.keyId}"]`).text()).toContain('Revoked');
    expect(wrapper.findAll('button').filter((b) => b.text() === 'Revoke')).toHaveLength(1);
  });

  it('shows the empty state', async () => {
    vi.mocked(listPortwingKeys).mockResolvedValue([]);
    const wrapper = await mountPanel();
    expect(wrapper.text()).toContain('No edge agent keys registered');
  });

  it('shows a load error and no controls blocked', async () => {
    vi.mocked(listPortwingKeys).mockRejectedValue(new Error('boom'));
    const wrapper = await mountPanel();
    expect(wrapper.find('[role="alert"]').text()).toBe('boom');
    expect(wrapper.find('[data-testid="edge-keys-forbidden"]').exists()).toBe(false);
  });

  it('falls back to the localized load error for non-Error rejections', async () => {
    vi.mocked(listPortwingKeys).mockRejectedValue(undefined);
    const wrapper = await mountPanel();
    expect(wrapper.find('[role="alert"]').text()).toBe('Failed to load edge agent keys');
  });

  it('renders the non-admin view when the API refuses the session', async () => {
    vi.mocked(listPortwingKeys).mockRejectedValue(new ApiError('nope', 403));
    const wrapper = await mountPanel();
    expect(wrapper.find('[data-testid="edge-keys-forbidden"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Register key');
    expect(wrapper.text()).not.toContain('No edge agent keys registered');
  });

  it('hides write controls when keys load but the session turns out read-only on revoke', async () => {
    vi.mocked(revokePortwingKey).mockRejectedValue(new ApiError('nope', 500));
    const wrapper = await mountPanel();
    await button(wrapper, 'Revoke').trigger('click');
    useConfirmDialog().current.value?.accept();
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe('nope');
    expect(wrapper.find('[data-testid="edge-keys-forbidden"]').exists()).toBe(false);
  });

  it('registers a key, prefills the snippet and reloads', async () => {
    vi.mocked(registerPortwingKey).mockResolvedValue({
      keyId: active.keyId,
      label: 'prod-agent',
      createdAt: active.createdAt,
    });
    const wrapper = await mountPanel();
    await button(wrapper, 'Register key').trigger('click');
    await fillForm(wrapper, ' prod-agent ', `ed25519 ${KEY} comment`);
    await button(wrapper, 'Register').trigger('click');
    await flushPromises();

    expect(registerPortwingKey).toHaveBeenCalledWith({ pubkeyBase64: KEY, label: 'prod-agent' });
    expect(wrapper.find('[data-testid="edge-keys-registered"]').text()).toBe(
      `Registered prod-agent as key ${active.keyId}.`,
    );
    expect(wrapper.find('[data-testid="edge-keys-snippet"]').exists()).toBe(true);
    expect(listPortwingKeys).toHaveBeenCalledTimes(2);
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('offers the keygen comment as the label', async () => {
    const wrapper = await mountPanel();
    await button(wrapper, 'Register key').trigger('click');
    await wrapper.find('textarea').setValue(`ed25519 ${KEY} edge-host-09`);
    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe(
      'edge-host-09',
    );
    await wrapper.find('input[type="text"]').setValue('mine');
    await wrapper.find('textarea').setValue(`ed25519 ${KEY} other`);
    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('mine');
  });

  it('rejects an invalid public key without calling the API', async () => {
    const wrapper = await mountPanel();
    await button(wrapper, 'Register key').trigger('click');
    await fillForm(wrapper, 'x', 'garbage');
    await button(wrapper, 'Register').trigger('click');
    await flushPromises();
    expect(registerPortwingKey).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('must be base64 and decode to exactly 32 bytes');
  });

  it('keeps Register disabled until both fields are filled and Cancel closes the form', async () => {
    const wrapper = await mountPanel();
    await button(wrapper, 'Register key').trigger('click');
    expect(button(wrapper, 'Register').attributes('disabled')).toBeDefined();
    await button(wrapper, 'Cancel').trigger('click');
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('shows a register error and keeps the form open', async () => {
    vi.mocked(registerPortwingKey).mockRejectedValue(new Error('Key is already active'));
    const wrapper = await mountPanel();
    await button(wrapper, 'Register key').trigger('click');
    await fillForm(wrapper, 'x', KEY);
    await button(wrapper, 'Register').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Key is already active');
    expect(wrapper.find('textarea').exists()).toBe(true);
  });

  it('falls back to the localized register error', async () => {
    vi.mocked(registerPortwingKey).mockRejectedValue(undefined);
    const wrapper = await mountPanel();
    await button(wrapper, 'Register key').trigger('click');
    await fillForm(wrapper, 'x', KEY);
    await button(wrapper, 'Register').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Failed to register key');
  });

  it('switches to the non-admin view when register is refused', async () => {
    vi.mocked(registerPortwingKey).mockRejectedValue(new ApiError('Forbidden for recovery', 403));
    const wrapper = await mountPanel();
    await button(wrapper, 'Register key').trigger('click');
    await fillForm(wrapper, 'x', KEY);
    await button(wrapper, 'Register').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="edge-keys-forbidden"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Register key');
  });

  it('revokes after confirmation and reloads', async () => {
    vi.mocked(revokePortwingKey).mockResolvedValue(undefined);
    const wrapper = await mountPanel();
    await button(wrapper, 'Revoke').trigger('click');
    expect(revokePortwingKey).not.toHaveBeenCalled();
    useConfirmDialog().current.value?.accept();
    await flushPromises();
    expect(revokePortwingKey).toHaveBeenCalledWith(active.keyId);
    expect(listPortwingKeys).toHaveBeenCalledTimes(2);
  });

  it('falls back to the localized revoke error', async () => {
    vi.mocked(revokePortwingKey).mockRejectedValue(undefined);
    const wrapper = await mountPanel();
    await button(wrapper, 'Revoke').trigger('click');
    useConfirmDialog().current.value?.accept();
    await flushPromises();
    expect(wrapper.text()).toContain('Failed to revoke key');
  });

  describe('agent snippet', () => {
    it('is hidden by default, prefilled with the browser origin and editable', async () => {
      const wrapper = await mountPanel();
      expect(wrapper.find('[data-testid="edge-keys-snippet"]').exists()).toBe(false);
      await button(wrapper, 'Show agent snippet').trigger('click');
      const urlInput = wrapper.find('[data-testid="edge-keys-controller-url"]');
      expect((urlInput.element as HTMLInputElement).value).toBe(globalThis.location.origin);
      expect(wrapper.find('[data-testid="snippet-compose"]').text()).toContain(
        `DRYDOCK_URL=${globalThis.location.origin}`,
      );
      await urlInput.setValue('https://dd.example.com/');
      await wrapper.find('[data-testid="edge-keys-agent-name"]').setValue('nas-1');
      expect(wrapper.find('[data-testid="snippet-docker-run"]').text()).toContain(
        "DRYDOCK_URL='https://dd.example.com'",
      );
      expect(wrapper.find('[data-testid="snippet-docker-run"]').text()).toContain(
        "AGENT_NAME='nas-1'",
      );
      await button(wrapper, 'Hide agent snippet').trigger('click');
      expect(wrapper.find('[data-testid="edge-keys-snippet"]').exists()).toBe(false);
    });

    it('copies the compose and docker run snippets', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const wrapper = await mountPanel();
      await button(wrapper, 'Show agent snippet').trigger('click');

      await wrapper.find('[data-testid="copy-compose"]').trigger('click');
      expect(writeText).toHaveBeenLastCalledWith(
        wrapper.find('[data-testid="snippet-compose"]').text(),
      );
      expect(wrapper.find('[data-testid="copy-compose"]').text()).toBe('Copied');

      await wrapper.find('[data-testid="copy-docker-run"]').trigger('click');
      expect(writeText).toHaveBeenLastCalledWith(
        wrapper.find('[data-testid="snippet-docker-run"]').text(),
      );
      expect(wrapper.find('[data-testid="copy-docker-run"]').text()).toBe('Copied');
    });

    it('does nothing when the clipboard is unavailable', async () => {
      vi.stubGlobal('navigator', {});
      const wrapper = await mountPanel();
      await button(wrapper, 'Show agent snippet').trigger('click');
      await wrapper.find('[data-testid="copy-compose"]').trigger('click');
      expect(wrapper.find('[data-testid="copy-compose"]').text()).toBe('Copy');
    });
  });
});
