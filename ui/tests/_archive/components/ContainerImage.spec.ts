import { mount } from '@vue/test-utils';
import ContainerImage from '@/components/ContainerImage.vue';

vi.mock('@/services/registry', () => ({
  getRegistryProviderIcon: vi.fn((name: string) => {
    const icons: Record<string, string> = {
      hub: 'si-docker',
      ghcr: 'si-github',
      ecr: 'si-amazonaws',
    };
    return icons[name] || 'fas fa-circle-question';
  }),
}));

const mockImage = {
  id: 'sha256:abc123',
  name: 'myapp',
  registry: { name: 'hub' },
  tag: { value: '2.1.0', semver: true },
  digest: { value: 'sha256:deadbeef1234567890' },
  os: 'linux',
  architecture: 'amd64',
  created: '2024-01-15T10:30:00Z',
};

describe('ContainerImage', () => {
  let wrapper: any;

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    wrapper = mount(ContainerImage, {
      props: { image: mockImage },
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders image id', () => {
    expect(wrapper.text()).toContain('sha256:abc123');
  });

  it('renders image name', () => {
    expect(wrapper.text()).toContain('myapp');
  });

  it('renders registry name', () => {
    expect(wrapper.text()).toContain('hub');
  });

  it('renders tag value', () => {
    expect(wrapper.text()).toContain('2.1.0');
  });

  it('renders semver chip when tag is semver', () => {
    expect(wrapper.text()).toContain('semver');
  });

  it('does not render semver chip when tag is not semver', async () => {
    await wrapper.setProps({
      image: { ...mockImage, tag: { value: 'latest', semver: false } },
    });
    const chips = wrapper.findAll('.v-chip');
    const semverChip = chips.filter((c: any) => c.text() === 'semver');
    expect(semverChip.length).toBe(0);
  });

  it('renders digest when present', () => {
    expect(wrapper.text()).toContain('sha256:deadbeef1234567890');
  });

  it('hides digest section when digest value is empty', async () => {
    await wrapper.setProps({
      image: { ...mockImage, digest: { value: '' } },
    });
    expect(wrapper.text()).not.toContain('Digest');
  });

  it('renders OS and architecture', () => {
    expect(wrapper.text()).toContain('linux');
    expect(wrapper.text()).toContain('amd64');
  });

  it('renders created date', () => {
    expect(wrapper.text()).toContain(new Date('2024-01-15T10:30:00Z').toLocaleDateString());
  });

  it('hides created when not present', async () => {
    const { created, ...imageWithout } = mockImage;
    await wrapper.setProps({ image: imageWithout });
    expect(wrapper.text()).not.toContain('Created');
  });

  it('computes registryIcon for hub', () => {
    expect(wrapper.vm.registryIcon).toBe('si-docker');
  });

  it('computes registryIcon for unknown registry', async () => {
    await wrapper.setProps({
      image: { ...mockImage, registry: { name: 'custom' } },
    });
    expect(wrapper.vm.registryIcon).toBe('fas fa-circle-question');
  });

  it('computes osIcon for linux', () => {
    expect(wrapper.vm.osIcon).toBe('fab fa-linux');
  });

  it('computes osIcon for windows', async () => {
    await wrapper.setProps({
      image: { ...mockImage, os: 'windows' },
    });
    expect(wrapper.vm.osIcon).toBe('fab fa-windows');
  });

  it('computes osIcon for unknown OS', async () => {
    await wrapper.setProps({
      image: { ...mockImage, os: 'freebsd' },
    });
    expect(wrapper.vm.osIcon).toBe('fas fa-circle-question');
  });

  it('copies image id to clipboard', async () => {
    await wrapper.vm.copyToClipboard('image id', 'sha256:abc123');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sha256:abc123');
  });

  it('emits notify after copying', async () => {
    await wrapper.vm.copyToClipboard('image digest', 'sha256:deadbeef1234567890');
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'image digest copied to clipboard',
    );
  });

  it('renders lookup image when present', async () => {
    await wrapper.setProps({
      image: { ...mockImage, registry: { name: 'hub', lookupImage: 'library/myapp' } },
    });
    expect(wrapper.text()).toContain('library/myapp');
    expect(wrapper.text()).toContain('(lookup)');
  });

  it('invokes clipboard handlers from template copy buttons', async () => {
    const copySpy = vi.spyOn(wrapper.vm, 'copyToClipboard');
    const buttons = wrapper.findAll('.v-btn');

    await buttons[0].trigger('click');
    await buttons[1].trigger('click');

    expect(copySpy).toHaveBeenCalledWith('image id', 'sha256:abc123');
    expect(copySpy).toHaveBeenCalledWith('image digest', 'sha256:deadbeef1234567890');
  });
});
