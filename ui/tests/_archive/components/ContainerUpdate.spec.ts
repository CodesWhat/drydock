import { mount } from '@vue/test-utils';
import ContainerUpdate from '@/components/ContainerUpdate.vue';

const mockUpdateKind = {
  kind: 'tag',
  localValue: '1.0.0',
  remoteValue: '2.0.0',
  semverDiff: 'major',
};

const mockResult = {
  tag: '2.0.0',
  created: '2023-01-02T00:00:00Z',
  digest: 'sha256:abcdef123456',
  link: 'https://hub.docker.com/r/library/nginx/tags/2.0.0',
};

describe('ContainerUpdate', () => {
  let wrapper;

  beforeEach(() => {
    wrapper = mount(ContainerUpdate, {
      props: {
        updateKind: mockUpdateKind,
        result: mockResult,
        updateAvailable: true,
        semver: true,
      },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe('updateKindFormatted computed', () => {
    it('returns semverDiff when present', () => {
      expect(wrapper.vm.updateKindFormatted).toBe('major');
    });

    it('returns kind when no semverDiff', async () => {
      await wrapper.setProps({
        updateKind: { kind: 'digest' },
      });
      expect(wrapper.vm.updateKindFormatted).toBe('digest');
    });

    it('returns "Unknown" when updateKind is null', async () => {
      await wrapper.setProps({ updateKind: null, updateAvailable: false });
      expect(wrapper.vm.updateKindFormatted).toBe('Unknown');
    });

    it('returns "Unknown" when updateKind is undefined', async () => {
      await wrapper.setProps({ updateKind: undefined, updateAvailable: false });
      expect(wrapper.vm.updateKindFormatted).toBe('Unknown');
    });

    it('returns minor for minor semverDiff', async () => {
      await wrapper.setProps({
        updateKind: { kind: 'tag', semverDiff: 'minor' },
      });
      expect(wrapper.vm.updateKindFormatted).toBe('minor');
    });

    it('returns patch for patch semverDiff', async () => {
      await wrapper.setProps({
        updateKind: { kind: 'tag', semverDiff: 'patch' },
      });
      expect(wrapper.vm.updateKindFormatted).toBe('patch');
    });
  });

  describe('copyToClipboard', () => {
    it('copies value to clipboard and emits notify', () => {
      const writeTextMock = vi.fn();
      Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

      wrapper.vm.copyToClipboard('update tag', '2.0.0');

      expect(writeTextMock).toHaveBeenCalledWith('2.0.0');
      expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
        'notify',
        'update tag copied to clipboard',
      );
    });

    it('copies digest to clipboard', () => {
      const writeTextMock = vi.fn();
      Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

      wrapper.vm.copyToClipboard('update digest', 'sha256:abcdef123456');

      expect(writeTextMock).toHaveBeenCalledWith('sha256:abcdef123456');
    });
  });

  describe('rendering with updateAvailable=true', () => {
    it('shows tag info', () => {
      expect(wrapper.text()).toContain('2.0.0');
    });

    it('shows digest info', () => {
      expect(wrapper.text()).toContain('sha256:abcdef123456');
    });

    it('shows link', () => {
      const link = wrapper.find('a[href="https://hub.docker.com/r/library/nginx/tags/2.0.0"]');
      expect(link.exists()).toBe(true);
    });

    it('shows semver chip when semver is true', () => {
      expect(wrapper.text()).toContain('semver');
    });

    it('shows update kind', () => {
      expect(wrapper.text()).toContain('Update kind');
    });
  });

  describe('rendering with updateAvailable=false', () => {
    it('shows "No update available"', async () => {
      await wrapper.setProps({ updateAvailable: false });
      expect(wrapper.text()).toContain('No update available');
    });
  });

  it('handles missing result.tag', async () => {
    await wrapper.setProps({ result: { digest: 'sha256:abc' } });
    expect(wrapper.exists()).toBe(true);
  });

  it('handles missing result.link', async () => {
    await wrapper.setProps({ result: { tag: '2.0.0' } });
    expect(wrapper.exists()).toBe(true);
  });

  it('handles missing result.digest', async () => {
    await wrapper.setProps({ result: { tag: '2.0.0' } });
    expect(wrapper.exists()).toBe(true);
  });

  it('invokes copy handlers from tag/digest template buttons', async () => {
    const copySpy = vi.spyOn(wrapper.vm, 'copyToClipboard');
    const buttons = wrapper.findAll('.v-btn');

    await buttons[0].trigger('click');
    await buttons[1].trigger('click');

    expect(copySpy).toHaveBeenCalledWith('update tag', '2.0.0');
    expect(copySpy).toHaveBeenCalledWith('update digest', 'sha256:abcdef123456');
  });
});
