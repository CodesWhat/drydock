import { mount } from '@vue/test-utils';
import IconRenderer from '@/components/IconRenderer.vue';

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

  it('switches selfhst icons to fallback CDN on first selfhst image error', () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'sh-docker' },
    });

    expect(wrapper.vm.useFallbackCdn).toBe(false);
    expect(wrapper.vm.selfhstIconUrl).toBe(
      'https://cdn.jsdelivr.net/gh/selfhst/icons/png/docker.png',
    );

    wrapper.vm.onImgError(true);

    expect(wrapper.vm.useFallbackCdn).toBe(true);
    expect(wrapper.vm.selfhstIconUrl).toBe(
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/docker.png',
    );
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

  it('renders fallback v-icon branch when image load fails', async () => {
    const wrapper = mount(IconRenderer, {
      props: { icon: 'si-docker', fallbackIcon: 'fas fa-circle-question' },
    });

    wrapper.vm.onImgError(false);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.v-icon').exists()).toBe(true);
    expect(wrapper.text()).toContain('fas fa-circle-question');
  });

  it('renders each template branch based on icon type', () => {
    const selfhst = mount(IconRenderer, { props: { icon: 'sh-docker' } });
    expect(selfhst.find('img').attributes('src')).toContain('/selfhst/icons/');

    const simple = mount(IconRenderer, { props: { icon: 'si-docker' } });
    expect(simple.find('img.simple-icon').exists()).toBe(true);

    const custom = mount(IconRenderer, { props: { icon: 'https://cdn.example.com/icon.png' } });
    expect(custom.find('img.custom-icon').exists()).toBe(true);

    const font = mount(IconRenderer, { props: { icon: 'fas:box' } });
    expect(font.find('.v-icon').exists()).toBe(true);
  });

  it('executes homarr image error handler from template', async () => {
    const wrapper = mount(IconRenderer, { props: { icon: 'hl-docker' } });
    await wrapper.find('img').trigger('error');
    expect(wrapper.vm.imgFailed).toBe(true);
  });

  it('executes selfhst image error handler from template', async () => {
    const wrapper = mount(IconRenderer, { props: { icon: 'sh-docker' } });
    await wrapper.find('img').trigger('error');
    expect(wrapper.vm.useFallbackCdn).toBe(true);
  });

  it('executes simple icon image error handler from template', async () => {
    const wrapper = mount(IconRenderer, { props: { icon: 'si-docker' } });
    await wrapper.find('img').trigger('error');
    expect(wrapper.vm.imgFailed).toBe(true);
  });

  it('executes custom icon image error handler from template', async () => {
    const wrapper = mount(IconRenderer, { props: { icon: 'https://cdn.example.com/icon.png' } });
    await wrapper.find('img').trigger('error');
    expect(wrapper.vm.imgFailed).toBe(true);
  });
});
