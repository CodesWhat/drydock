import { type Component, defineComponent } from 'vue';
import { mountWithPlugins } from '../../helpers/mount';

const registryLinkModulePath = '../../../src/components/containers/RegistryLink.vue';
let RegistryLink: Component;

beforeAll(async () => {
  RegistryLink = (await import(registryLinkModulePath)).default as Component;
});

function mountRegistryLink(props: Record<string, unknown>) {
  return mountWithPlugins(RegistryLink, { props });
}

function registryLookup(wrapper: ReturnType<typeof mountRegistryLink>): string | null {
  const href = wrapper.get('[data-test="registry-link"]').attributes('href');
  return new URL(href, 'http://localhost').searchParams.get('q');
}

describe('RegistryLink', () => {
  it('prefers the registry name and stays inside the Registries view', () => {
    const wrapper = mountRegistryLink({
      registry: 'dockerhub',
      registryName: 'Production Hub',
      registryUrl: 'https://registry.example.com/v2',
    });
    const link = wrapper.get('[data-test="registry-link"]');
    const href = new URL(link.attributes('href'), 'http://localhost');

    expect(href.pathname).toBe('/registries');
    expect(href.searchParams.get('q')).toBe('Production Hub');
    expect(link.attributes('target')).toBeUndefined();
    expect(link.attributes('href')).not.toContain('https://registry.example.com/v2');
  });

  it.each([
    ['dockerhub', 'hub'],
    ['ghcr', 'ghcr'],
  ])('normalizes the %s registry fallback to %s', (registry, expectedLookup) => {
    const wrapper = mountRegistryLink({ registry });

    expect(registryLookup(wrapper)).toBe(expectedLookup);
  });

  it('uses a custom registry host as the fallback without linking to its raw /v2 API', () => {
    const wrapper = mountRegistryLink({
      registry: 'custom',
      registryUrl: 'https://registry.example.com/v2',
    });
    const link = wrapper.get('[data-test="registry-link"]');

    expect(registryLookup(wrapper)).toBe('registry.example.com');
    expect(link.attributes('href')).not.toContain('/v2');
  });

  it('normalizes a scheme-less custom registry host', () => {
    const wrapper = mountRegistryLink({
      registry: 'custom',
      registryUrl: 'registry.example.com/v2',
    });

    expect(registryLookup(wrapper)).toBe('registry.example.com');
  });

  it('preserves a custom registry port in the lookup', () => {
    const wrapper = mountRegistryLink({
      registry: 'custom',
      registryUrl: 'https://registry.example.com:5000/v2',
    });

    expect(registryLookup(wrapper)).toBe('registry.example.com:5000');
  });

  it('renders nothing when no registry lookup can be derived', () => {
    const wrapper = mountRegistryLink({});

    expect(wrapper.find('[data-test="registry-link"]').exists()).toBe(false);
  });

  it('renders nothing when a custom registry URL is invalid', () => {
    const wrapper = mountRegistryLink({
      registry: 'custom',
      registryUrl: 'http://[',
    });

    expect(wrapper.find('[data-test="registry-link"]').exists()).toBe(false);
  });

  it('uses a 44px same-tab action and stops click propagation', async () => {
    const parentClick = vi.fn();
    const host = defineComponent({
      components: { RegistryLink },
      setup: () => ({ parentClick }),
      template: '<div data-test="host" @click="parentClick"><RegistryLink registry="ghcr" /></div>',
    });
    const wrapper = mountWithPlugins(host);
    const link = wrapper.get('[data-test="registry-link"]');
    link.element.addEventListener('click', (event) => event.preventDefault(), { once: true });

    await link.trigger('click');

    expect(link.classes()).toEqual(expect.arrayContaining(['w-11', 'h-11']));
    expect(link.attributes('target')).toBeUndefined();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
