import {
  getAllRegistries,
  getRegistry,
  getRegistryIcon,
  getRegistryProviderColor,
  getRegistryProviderIcon,
} from '@/services/registry';

// Mock fetch globally
global.fetch = vi.fn();

describe('Registry Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  describe('getRegistryIcon', () => {
    it('returns the registry icon', () => {
      expect(getRegistryIcon()).toBe('sh-docker');
    });
  });

  describe('getRegistryProviderIcon', () => {
    it('returns correct icons for different providers', () => {
      expect(getRegistryProviderIcon('acr.example.com')).toBe('sh-microsoft');
      expect(getRegistryProviderIcon('custom.registry.com')).toBe('sh-docker');
      expect(getRegistryProviderIcon('ecr.amazonaws.com')).toBe('sh-amazon-web-services');
      expect(getRegistryProviderIcon('forgejo.example.com')).toBe('sh-forgejo');
      expect(getRegistryProviderIcon('gcr.io')).toBe('sh-google');
      expect(getRegistryProviderIcon('ghcr.io')).toBe('sh-github');
      expect(getRegistryProviderIcon('gitea.example.com')).toBe('sh-gitea');
      expect(getRegistryProviderIcon('gitlab.com')).toBe('sh-gitlab');
      expect(getRegistryProviderIcon('hub.docker.com')).toBe('sh-docker');
      expect(getRegistryProviderIcon('quay.io')).toBe('sh-quay');
      expect(getRegistryProviderIcon('lscr.io')).toBe('sh-linux');
      expect(getRegistryProviderIcon('codeberg.org')).toBe('sh-codeberg');
      expect(getRegistryProviderIcon('dhi.example.com')).toBe('sh-docker');
      expect(getRegistryProviderIcon('docr.digitalocean.com')).toBe('sh-digitalocean');
      expect(getRegistryProviderIcon('alicr.aliyuncs.com')).toBe('sh-alibaba-cloud');
      expect(getRegistryProviderIcon('artifactory.acme.com')).toBe('sh-jfrog-artifactory');
      expect(getRegistryProviderIcon('gar.pkg.dev')).toBe('sh-google');
      expect(getRegistryProviderIcon('harbor.acme.com')).toBe('sh-harbor');
      expect(getRegistryProviderIcon('ibmcr.icr.io')).toBe('sh-ibm');
      expect(getRegistryProviderIcon('nexus.acme.com')).toBe('sh-sonatype-nexus-repository');
      expect(getRegistryProviderIcon('ocir.io')).toBe('sh-oracle-cloud');
      expect(getRegistryProviderIcon('trueforge.example')).toBe('sh-docker');
    });

    it('returns default icon for unknown providers', () => {
      expect(getRegistryProviderIcon('unknown.registry')).toBe('sh-docker');
    });

    it('returns default icon when provider is missing', () => {
      expect(getRegistryProviderIcon(undefined)).toBe('sh-docker');
    });

    it('handles provider names with dots correctly', () => {
      expect(getRegistryProviderIcon('hub.docker.com')).toBe('sh-docker');
      expect(getRegistryProviderIcon('gcr.io')).toBe('sh-google');
    });
  });

  describe('getRegistryProviderColor', () => {
    it.each([
      ['acr.example.com', '#0078D4'],
      ['ecr.amazonaws.com', '#FF9900'],
      ['forgejo.example.com', '#FB923C'],
      ['gcr.io', '#4285F4'],
      ['ghcr.io', '#8B5CF6'],
      ['gitea.example.com', '#609926'],
      ['gitlab.com', '#FC6D26'],
      ['hub.docker.com', '#2496ED'],
      ['quay.io', '#EE0000'],
      ['lscr.io', '#DA3B8A'],
      ['codeberg.org', '#2185D0'],
      ['dhi.example.com', '#2496ED'],
      ['docr.digitalocean.com', '#0080FF'],
      ['alicr.aliyuncs.com', '#FF6A00'],
      ['artifactory.acme.com', '#41BF47'],
      ['gar.pkg.dev', '#4285F4'],
      ['harbor.acme.com', '#60B932'],
      ['ibmcr.icr.io', '#0F62FE'],
      ['nexus.acme.com', '#1B1C30'],
      ['ocir.io', '#F80000'],
      ['custom.registry.com', '#6B7280'],
      ['trueforge.example', '#6B7280'],
      ['unknown.registry', '#6B7280'],
    ])('returns %s color', (provider, color) => {
      expect(getRegistryProviderColor(provider)).toBe(color);
    });
  });

  describe('getAllRegistries', () => {
    it('fetches all registries successfully', async () => {
      const mockRegistries = [
        { name: 'hub', type: 'docker' },
        { name: 'ghcr', type: 'github' },
      ];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRegistries,
      } as any);

      const registries = await getAllRegistries();

      expect(fetch).toHaveBeenCalledWith('/api/registries', {
        credentials: 'include',
      });
      expect(registries).toEqual(mockRegistries);
    });
  });

  describe('getRegistry', () => {
    it('fetches a specific registry by type and name', async () => {
      const mockRegistry = { id: 'hub.private', type: 'hub', name: 'private' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRegistry,
      } as any);

      const result = await getRegistry({ type: 'hub', name: 'private' });

      expect(fetch).toHaveBeenCalledWith('/api/registries/hub/private', {
        credentials: 'include',
      });
      expect(result).toEqual(mockRegistry);
    });

    it('fetches an agent-scoped registry when agent is provided', async () => {
      const mockRegistry = { id: 'edge.hub.private', type: 'hub', name: 'private', agent: 'edge' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRegistry,
      } as any);

      const result = await getRegistry({ agent: 'edge', type: 'hub', name: 'private' });

      expect(fetch).toHaveBeenCalledWith('/api/registries/edge/hub/private', {
        credentials: 'include',
      });
      expect(result).toEqual(mockRegistry);
    });
  });
});
