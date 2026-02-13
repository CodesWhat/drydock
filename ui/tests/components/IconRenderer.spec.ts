import { mount } from '@vue/test-utils';
import IconRenderer from '@/components/IconRenderer';

describe('IconRenderer', () => {
  it('renders v-icon for standard mdi icons', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'mdi-docker' },
    });

    expect(wrapper.find('.v-icon').exists()).toBe(true);
    expect(wrapper.vm.normalizedIcon).toBe('mdi-docker');
  });

  it('handles homarr icons', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'homarr-test' },
    });

    expect(wrapper.vm.icon).toBe('homarr-test');
  });

  it('handles selfhst icons', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'selfhst-test' },
    });

    expect(wrapper.vm.icon).toBe('selfhst-test');
  });

  it('handles simple icons', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'si-docker' },
    });

    expect(wrapper.vm.isSimpleIcon).toBeTruthy();
  });

  it('renders img for Homarr icons', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'hl-docker' },
    });

    expect(wrapper.find('img').exists()).toBe(true);
    expect(wrapper.vm.isHomarrIcon).toBe(true);
    expect(wrapper.vm.homarrIconUrl).toContain('docker.png');
  });

  it('renders img for Selfhst icons', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'sh-docker' },
    });

    expect(wrapper.find('img').exists()).toBe(true);
    expect(wrapper.vm.isSelfhstIcon).toBe(true);
    expect(wrapper.vm.selfhstIconUrl).toContain('docker.png');
  });

  it('renders img for Simple icons', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'si-docker' },
    });

    expect(wrapper.find('img.simple-icon').exists()).toBe(true);
    expect(wrapper.vm.isSimpleIcon).toBe(true);
    expect(wrapper.vm.simpleIconUrl).toContain('docker.svg');
  });

  it('renders img for custom icon URL', () => {
    const iconUrl = 'https://my.domain.com/image.png';
    const wrapper = mount(IconRenderer, {
      props: { icon: iconUrl },
    });

    const image = wrapper.find('img.custom-icon');
    expect(image.exists()).toBe(true);
    expect(wrapper.vm.isCustomIconUrl).toBe(true);
    expect(wrapper.vm.customIconUrl).toBe(iconUrl);
  });

  it('treats absolute root-relative paths as custom icon URLs', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: '/assets/custom-logo.png' },
    });

    expect(wrapper.vm.isCustomIconUrl).toBe(true);
    expect(wrapper.vm.customIconUrl).toBe('/assets/custom-logo.png');
  });

  it('does not treat non-http values as custom URL icons', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'not-a-url' },
    });

    expect(wrapper.vm.isCustomIconUrl).toBe(false);
  });

  it('normalizes icon prefixes correctly', () => {
    const testCases = [
      { input: 'mdi:docker', expected: 'mdi:docker' },
      { input: 'fa:docker', expected: 'fa-docker' },
      { input: 'fab:docker', expected: 'fab fa-docker' },
      { input: 'far:docker', expected: 'far fa-docker' },
      { input: 'fas:docker', expected: 'fas fa-docker' },
      { input: 'si:docker', expected: 'si-docker' },
    ];

    testCases.forEach(({ input, expected }) => {
      const wrapper = mount(IconRenderer, {
        props: { icon: input },
      });
      expect(wrapper.vm.normalizedIcon).toBe(expected);
    });
  });

  it('handles undefined icon gracefully', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: '' },
    });

    expect(wrapper.vm.isHomarrIcon).toBe(false);
    expect(wrapper.vm.isSelfhstIcon).toBe(false);
    expect(wrapper.vm.isSimpleIcon).toBe(false);
    expect(wrapper.vm.normalizedIcon).toBe('');
  });

  it('handles null icon gracefully', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: '' },
    });

    expect(wrapper.vm.isHomarrIcon).toBe(false);
    expect(wrapper.vm.isSelfhstIcon).toBe(false);
    expect(wrapper.vm.isSimpleIcon).toBe(false);
    expect(wrapper.vm.normalizedIcon).toBe('');
  });

  it('sets image fallback state on image error and resets on icon change', async () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'si-docker' },
    });

    expect(wrapper.vm.imgFailed).toBe(false);
    wrapper.vm.onImgError();
    expect(wrapper.vm.imgFailed).toBe(true);

    await wrapper.setProps({ icon: 'si-github' });
    expect(wrapper.vm.imgFailed).toBe(false);
  });

  it('applies correct styling based on props', () => {
    const wrapper = mount(IconRenderer, {
      props: {
        icon: 'mdi-docker',
        size: 32,
        marginRight: 16,
      },
    });

    const style = wrapper.vm.iconStyle;
    expect(style.width).toBe('32px');
    expect(style.height).toBe('32px');
    expect(style.marginRight).toBe('16px');
  });

  it('uses default size and margin when not specified', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'mdi-docker' },
    });

    const style = wrapper.vm.iconStyle;
    expect(style.width).toBe('24px');
    expect(style.height).toBe('24px');
    expect(style.marginRight).toBe('8px');
  });

  it('generates correct URLs for different icon types', () => {
    const homarrWrapper = mount(IconRenderer, {
      props: { icon: 'hl:test-app' },
    });
    expect(homarrWrapper.vm.homarrIconUrl).toBe(
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/test-app.png',
    );

    const selfhstWrapper = mount(IconRenderer, {
      props: { icon: 'sh:test-app' },
    });
    expect(selfhstWrapper.vm.selfhstIconUrl).toBe(
      'https://cdn.jsdelivr.net/gh/selfhst/icons/png/test-app.png',
    );

    const simpleWrapper = mount(IconRenderer, {
      props: { icon: 'si-testapp' },
    });
    expect(simpleWrapper.vm.simpleIconUrl).toBe(
      'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/testapp.svg',
    );
  });

  it('detects icon types correctly with colon syntax', () => {
    const homarrWrapper = mount(IconRenderer, {
      props: { icon: 'hl:docker' },
    });
    expect(homarrWrapper.vm.isHomarrIcon).toBe(true);

    const selfhstWrapper = mount(IconRenderer, {
      props: { icon: 'sh:docker' },
    });
    expect(selfhstWrapper.vm.isSelfhstIcon).toBe(true);
  });
});
