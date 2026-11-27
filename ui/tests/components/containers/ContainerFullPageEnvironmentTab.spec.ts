import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import ContainerFullPageEnvironmentTab from '@/components/containers/ContainerFullPageEnvironmentTab.vue';

const mockRevealContainerEnv = vi.hoisted(() => vi.fn());

interface EnvEntry {
  key: string;
  value: string;
  sensitive?: boolean;
}

function makeContainer(overrides: { id?: string; env?: EnvEntry[]; volumes?: string[] } = {}) {
  return {
    id: overrides.id ?? 'container-1',
    details: { env: overrides.env ?? [], volumes: overrides.volumes ?? [] },
  };
}

const selectedContainer = ref(makeContainer());

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ({ selectedContainer }),
}));

vi.mock('@/services/container', () => ({
  revealContainerEnv: mockRevealContainerEnv,
}));

function mountComponent() {
  return mount(ContainerFullPageEnvironmentTab, {
    global: {
      stubs: {
        AppIcon: { template: '<span class="app-icon-stub" />', props: ['name', 'size'] },
        AppIconButton: {
          template: '<button class="reveal-stub" :disabled="disabled" @click="$emit(\'click\')" />',
          props: ['icon', 'size', 'variant', 'disabled'],
          emits: ['click'],
        },
      },
    },
  });
}

describe('ContainerFullPageEnvironmentTab', () => {
  beforeEach(() => {
    mockRevealContainerEnv.mockReset();
    selectedContainer.value = makeContainer();
  });

  it('shows the empty states when there are no env vars or volumes', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('No environment variables configured');
    expect(wrapper.text()).toContain('No volumes mounted');
  });

  it('lists plain env values and volumes with their counts', () => {
    selectedContainer.value = makeContainer({
      env: [{ key: 'TZ', value: 'UTC' }],
      volumes: ['/data:/var/lib/data', '/cfg:/etc/cfg'],
    });

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('TZ');
    expect(wrapper.text()).toContain('UTC');
    expect(wrapper.text()).toContain('/data:/var/lib/data');
    expect(wrapper.text()).toContain('/cfg:/etc/cfg');
    const counts = wrapper.findAll('.badge.ml-auto').map((badge) => badge.text());
    expect(counts).toEqual(['1', '2']);
    expect(wrapper.find('.reveal-stub').exists()).toBe(false);
  });

  it('masks a sensitive value until it is revealed, then fetches it once and caches it', async () => {
    mockRevealContainerEnv.mockResolvedValue({
      env: [{ key: 'API_KEY', value: 'hunter2' }],
    });
    selectedContainer.value = makeContainer({
      env: [{ key: 'API_KEY', value: '***', sensitive: true }],
    });
    const wrapper = mountComponent();

    expect(wrapper.text()).not.toContain('hunter2');

    await wrapper.get('.reveal-stub').trigger('click');
    await flushPromises();

    expect(mockRevealContainerEnv).toHaveBeenCalledWith('container-1');
    expect(wrapper.text()).toContain('hunter2');

    // Hide again, then reveal from the cache without another request.
    await wrapper.get('.reveal-stub').trigger('click');
    expect(wrapper.text()).not.toContain('hunter2');

    await wrapper.get('.reveal-stub').trigger('click');
    expect(wrapper.text()).toContain('hunter2');
    expect(mockRevealContainerEnv).toHaveBeenCalledTimes(1);
  });

  it('keeps the value masked and re-enables the button when the reveal request fails', async () => {
    mockRevealContainerEnv.mockRejectedValue(new Error('boom'));
    selectedContainer.value = makeContainer({
      id: 'container-2',
      env: [{ key: 'DB_PASSWORD', value: '***', sensitive: true }],
    });
    const wrapper = mountComponent();

    await wrapper.get('.reveal-stub').trigger('click');
    await flushPromises();

    expect(mockRevealContainerEnv).toHaveBeenCalledWith('container-2');
    expect(wrapper.text()).not.toContain('hunter2');
    expect(wrapper.get('.reveal-stub').attributes('disabled')).toBeUndefined();
  });

  it('tolerates a reveal response without an env list', async () => {
    mockRevealContainerEnv.mockResolvedValue({});
    selectedContainer.value = makeContainer({
      id: 'container-3',
      env: [{ key: 'TOKEN_X', value: '***', sensitive: true }],
    });
    const wrapper = mountComponent();

    await wrapper.get('.reveal-stub').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('TOKEN_X');
    expect(wrapper.text()).toContain('•••••');
  });
});
