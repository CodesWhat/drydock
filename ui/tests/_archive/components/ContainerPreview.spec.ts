import { mount } from '@vue/test-utils';
import ContainerPreview from '@/components/ContainerPreview.vue';

vi.mock('@/services/preview', () => ({
  previewContainer: vi.fn(),
}));

import { previewContainer } from '@/services/preview';

const mockPreview = {
  currentImage: 'nginx:1.0.0',
  newImage: 'nginx:1.1.0',
  updateKind: 'tag',
  networks: ['bridge', 'app-net'],
  changes: ['Tag updated from 1.0.0 to 1.1.0'],
};

describe('ContainerPreview', () => {
  let wrapper;

  function createWrapper(props = {}) {
    return mount(ContainerPreview, {
      props: {
        containerId: 'test-container-id',
        modelValue: false,
        ...props,
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('does not fetch preview when dialog is closed', () => {
    wrapper = createWrapper({ modelValue: false });
    expect(previewContainer).not.toHaveBeenCalled();
  });

  it('fetches preview when dialog opens', async () => {
    (previewContainer as any).mockResolvedValue(mockPreview);
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await wrapper.vm.$nextTick();

    expect(previewContainer).toHaveBeenCalledWith('test-container-id');
  });

  it('stores preview data on success', async () => {
    (previewContainer as any).mockResolvedValue(mockPreview);
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.preview).toEqual(mockPreview);
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.error).toBe('');
  });

  it('sets error on failure', async () => {
    (previewContainer as any).mockRejectedValue(new Error('Network error'));
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.error).toBe('Network error');
    expect(wrapper.vm.preview).toBeNull();
  });

  it('uses default error message when failure has no message', async () => {
    (previewContainer as any).mockRejectedValue({});
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.error).toBe('Failed to load preview');
    expect(wrapper.vm.loading).toBe(false);
  });

  it('computes update kind color for all supported update kinds', async () => {
    wrapper = createWrapper({ modelValue: false });

    expect(wrapper.vm.updateKindColor).toBe('info');

    wrapper.vm.preview = {
      updateKind: { kind: 'digest' },
    };
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.updateKindColor).toBe('info');

    wrapper.vm.preview = {
      updateKind: { kind: 'semver', semverDiff: 'major' },
    };
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.updateKindColor).toBe('error');

    wrapper.vm.preview = {
      updateKind: { kind: 'semver', semverDiff: 'minor' },
    };
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.updateKindColor).toBe('warning');

    wrapper.vm.preview = {
      updateKind: { kind: 'semver', semverDiff: 'patch' },
    };
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.updateKindColor).toBe('success');

    wrapper.vm.preview = {
      updateKind: { kind: 'semver', semverDiff: 'prerelease' },
    };
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.updateKindColor).toBe('info');
  });

  it('emits update:modelValue false when close is called', () => {
    wrapper = createWrapper({ modelValue: true });
    wrapper.vm.close();
    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')[0]).toEqual([false]);
  });

  it('emits update-confirmed and closes when confirmUpdate is called', () => {
    wrapper = createWrapper({ modelValue: true });
    wrapper.vm.confirmUpdate();
    expect(wrapper.emitted('update-confirmed')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
  });

  it('resets state when dialog closes', async () => {
    (previewContainer as any).mockResolvedValue(mockPreview);
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.preview).toEqual(mockPreview);

    await wrapper.setProps({ modelValue: false });
    expect(wrapper.vm.preview).toBeNull();
    expect(wrapper.vm.error).toBe('');
  });

  it('renders local to remote version diff when preview update kind includes both values', async () => {
    wrapper = createWrapper({ modelValue: true });
    await wrapper.setData({
      loading: false,
      error: '',
      preview: {
        currentImage: 'nginx:1.0.0',
        newImage: 'nginx:1.1.0',
        updateKind: {
          kind: 'semver',
          semverDiff: 'minor',
          localValue: '1.0.0',
          remoteValue: '1.1.0',
        },
        networks: [],
        changes: [],
      },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('1.0.0');
    expect(wrapper.text()).toContain('1.1.0');
  });
});
