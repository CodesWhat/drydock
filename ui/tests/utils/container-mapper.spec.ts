vi.mock('@/services/image-icon', () => ({
  getEffectiveDisplayIcon: vi.fn((_display: string, image: string) => `icon-${image}`),
}));

import { mapApiContainer, mapApiContainers } from '@/utils/container-mapper';

function makeApiContainer(overrides: Record<string, any> = {}) {
  return {
    id: 'c1',
    name: 'my-container',
    displayName: '',
    status: 'running',
    watcher: 'local',
    agent: null,
    image: {
      registry: { name: 'hub', url: 'https://registry-1.docker.io' },
      name: 'nginx',
      tag: { value: '1.25' },
    },
    result: null,
    updateAvailable: false,
    updateKind: null,
    security: null,
    labels: null,
    displayIcon: '',
    ...overrides,
  };
}

describe('container-mapper', () => {
  describe('deriveServer', () => {
    it('returns agent name when agent is set', () => {
      const c = mapApiContainer(makeApiContainer({ agent: 'remote-agent-1' }));
      expect(c.server).toBe('remote-agent-1');
    });

    it('returns Local when no agent', () => {
      const c = mapApiContainer(makeApiContainer({ agent: null }));
      expect(c.server).toBe('Local');
    });
  });

  describe('deriveRegistry', () => {
    it('detects dockerhub from registry name', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.registry).toBe('dockerhub');
    });

    it('detects dockerhub from url', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'custom', url: 'https://docker.io/v2' },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('dockerhub');
    });

    it('detects ghcr from registry name', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: { registry: { name: 'ghcr', url: '' }, name: 'img', tag: { value: 'latest' } },
        }),
      );
      expect(c.registry).toBe('ghcr');
    });

    it('detects ghcr from url', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'other', url: 'https://ghcr.io/v2' },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('ghcr');
    });

    it('returns custom for unknown registries', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'acr', url: 'https://myacr.azurecr.io' },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('custom');
    });
  });

  describe('deriveBouncer', () => {
    it('returns safe when no security data', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.bouncer).toBe('safe');
    });

    it('returns blocked when scan status is blocked', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: { scan: { status: 'blocked', summary: null } },
        }),
      );
      expect(c.bouncer).toBe('blocked');
    });

    it('returns unsafe when critical vulns exist', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: { scan: { status: 'done', summary: { critical: 2, high: 0 } } },
        }),
      );
      expect(c.bouncer).toBe('unsafe');
    });

    it('returns unsafe when high vulns exist', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: { scan: { status: 'done', summary: { critical: 0, high: 5 } } },
        }),
      );
      expect(c.bouncer).toBe('unsafe');
    });

    it('returns safe when only low/medium vulns', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: { scan: { status: 'done', summary: { critical: 0, high: 0, medium: 3 } } },
        }),
      );
      expect(c.bouncer).toBe('safe');
    });
  });

  describe('deriveUpdateKind', () => {
    it('returns null when no update available', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.updateKind).toBeNull();
    });

    it('returns digest for digest updates', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'digest' },
        }),
      );
      expect(c.updateKind).toBe('digest');
    });

    it('returns major for semver major diff', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'major' },
        }),
      );
      expect(c.updateKind).toBe('major');
    });

    it('returns minor for semver minor diff', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'minor' },
        }),
      );
      expect(c.updateKind).toBe('minor');
    });

    it('returns patch for semver patch diff', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'patch' },
        }),
      );
      expect(c.updateKind).toBe('patch');
    });

    it('returns patch for prerelease diff', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'prerelease' },
        }),
      );
      expect(c.updateKind).toBe('patch');
    });

    it('returns patch for unknown tag kind', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag' },
        }),
      );
      expect(c.updateKind).toBe('patch');
    });

    it('returns null when updateAvailable but no updateKind', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: null,
        }),
      );
      expect(c.updateKind).toBeNull();
    });
  });

  describe('mapApiContainer', () => {
    it('maps basic fields', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.id).toBe('c1');
      expect(c.name).toBe('my-container');
      expect(c.image).toBe('nginx');
      expect(c.currentTag).toBe('1.25');
      expect(c.status).toBe('running');
    });

    it('uses displayName over name when set', () => {
      const c = mapApiContainer(makeApiContainer({ displayName: 'My Nginx' }));
      expect(c.name).toBe('My Nginx');
    });

    it('defaults currentTag to latest when missing', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: { registry: { name: 'hub', url: '' }, name: 'nginx', tag: {} },
        }),
      );
      expect(c.currentTag).toBe('latest');
    });

    it('sets newTag from result when update available', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'minor' },
          result: { tag: '1.26' },
        }),
      );
      expect(c.newTag).toBe('1.26');
    });

    it('sets newTag to null when no update', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.newTag).toBeNull();
    });

    it('maps stopped status', () => {
      const c = mapApiContainer(makeApiContainer({ status: 'exited' }));
      expect(c.status).toBe('stopped');
    });

    it('calls getEffectiveDisplayIcon for icon', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.icon).toBe('icon-nginx');
    });

    it('extracts labels from object', () => {
      const c = mapApiContainer(
        makeApiContainer({
          labels: { 'dd.watch': 'true', 'dd.tag.include': '^\\d' },
        }),
      );
      expect(c.details.labels).toEqual(['dd.watch=true', 'dd.tag.include=^\\d']);
    });

    it('handles labels with empty values', () => {
      const c = mapApiContainer(
        makeApiContainer({
          labels: { 'dd.watch': '' },
        }),
      );
      expect(c.details.labels).toEqual(['dd.watch']);
    });

    it('returns empty labels when labels is null', () => {
      const c = mapApiContainer(makeApiContainer({ labels: null }));
      expect(c.details.labels).toEqual([]);
    });
  });

  describe('mapApiContainers', () => {
    it('maps an array of containers', () => {
      const result = mapApiContainers([
        makeApiContainer({ id: 'a' }),
        makeApiContainer({ id: 'b' }),
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('a');
      expect(result[1].id).toBe('b');
    });

    it('returns empty array for empty input', () => {
      expect(mapApiContainers([])).toEqual([]);
    });
  });
});
