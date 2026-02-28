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

    it('returns Local when watcher value is not a string', () => {
      const c = mapApiContainer(makeApiContainer({ watcher: { id: 'local' } }));
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
      ) as any;
      expect(c.registry).toBe('custom');
      expect(c.registryName).toBe('acr');
      expect(c.registryUrl).toBe('https://myacr.azurecr.io');
    });

    it('returns custom when registry url is not a string', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'custom', url: { href: 'https://example.com' } },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('custom');
      expect(c.registryUrl).toBeUndefined();
    });
  });

  describe('deriveBouncer', () => {
    it('returns safe when no security data', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.bouncer).toBe('safe');
      expect(c.securityScanState).toBe('not-scanned');
    });

    it('returns blocked when scan status is blocked', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: { scan: { status: 'blocked', summary: null } },
        }),
      );
      expect(c.bouncer).toBe('blocked');
      expect(c.securityScanState).toBe('scanned');
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

    it('maps the full security severity summary when present', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: {
            scan: {
              status: 'done',
              summary: { unknown: 1, low: 2, medium: 3, high: 4, critical: 5 },
            },
          },
        }),
      );
      expect(c.securitySummary).toEqual({
        unknown: 1,
        low: 2,
        medium: 3,
        high: 4,
        critical: 5,
      });
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

    it('falls back to name when displayName is not a string', () => {
      const c = mapApiContainer(
        makeApiContainer({
          displayName: { text: 'My Nginx' },
        }),
      );
      expect(c.name).toBe('my-container');
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

    it('maps release link from result.link', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'minor' },
          result: { tag: '1.26', link: 'https://example.com/changelog' },
        }),
      );
      expect((c as any).releaseLink).toBe('https://example.com/changelog');
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

    it('maps registry error message from error.message', () => {
      const c = mapApiContainer(
        makeApiContainer({
          error: { message: 'Registry request failed' },
        }),
      );
      expect((c as any).registryError).toBe('Registry request failed');
    });

    it('maps no-update reason from result.noUpdateReason', () => {
      const c = mapApiContainer(
        makeApiContainer({
          result: {
            tag: '1.2.3-ls132',
            noUpdateReason:
              'Strict tag-family policy filtered out 1 higher semver tag(s) outside the inferred family.',
          },
        }),
      );
      expect((c as any).noUpdateReason).toContain('Strict tag-family policy filtered out 1 higher semver');
    });

    it('marks suppressed snoozed updates for dashboard rendering', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: { kind: 'tag', semverDiff: 'minor', remoteValue: '1.26' },
          result: { tag: '1.26' },
          updatePolicy: {
            snoozeUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        }),
      );

      expect((c as any).updatePolicyState).toBe('snoozed');
      expect((c as any).suppressedUpdateTag).toBe('1.26');
    });

    it('marks suppressed skipped digest updates for dashboard rendering', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'digest',
            semverDiff: 'unknown',
            remoteValue: 'sha256:newdigest',
          },
          result: { digest: 'sha256:newdigest' },
          updatePolicy: {
            skipDigests: ['sha256:newdigest'],
          },
        }),
      );

      expect((c as any).updatePolicyState).toBe('skipped');
      expect((c as any).suppressedUpdateTag).toBe('sha256:newdigest');
    });

    it('maps updateDetectedAt from api payload when valid', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateDetectedAt: '2026-02-28T12:34:56.789Z',
        }),
      );
      expect(c.updateDetectedAt).toBe('2026-02-28T12:34:56.789Z');
    });

    it('ignores invalid updateDetectedAt values', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateDetectedAt: 'not-a-date',
        }),
      );
      expect(c.updateDetectedAt).toBeUndefined();
    });

    it('extracts labels from object', () => {
      const c = mapApiContainer(
        makeApiContainer({
          labels: { 'dd.watch': 'true', 'dd.tag.include': '^\\d' },
        }),
      );
      expect(c.details.labels).toEqual(['dd.watch=true', 'dd.tag.include=^\\d']);
    });

    it('maps tag filter regex config fields', () => {
      const c = mapApiContainer(
        makeApiContainer({
          includeTags: '^v\\d+\\.\\d+\\.\\d+$',
          excludeTags: '-beta$',
          transformTags: '^v(.*) => $1',
        }),
      );
      expect(c.includeTags).toBe('^v\\d+\\.\\d+\\.\\d+$');
      expect(c.excludeTags).toBe('-beta$');
      expect(c.transformTags).toBe('^v(.*) => $1');
    });

    it('maps trigger include/exclude config fields', () => {
      const c = mapApiContainer(
        makeApiContainer({
          triggerInclude: 'slack.default:major',
          triggerExclude: 'discord.default',
        }),
      ) as any;
      expect(c.triggerInclude).toBe('slack.default:major');
      expect(c.triggerExclude).toBe('discord.default');
    });

    it('maps tag and image metadata fields used by the containers view', () => {
      const c = mapApiContainer(
        makeApiContainer({
          tagFamily: 'loose',
          image: {
            registry: { name: 'hub', url: 'https://registry-1.docker.io' },
            name: 'nginx',
            variant: 'v8',
            tag: { value: '1.25', semver: true },
            digest: { watch: true, value: 'sha256:abc123', repo: 'sha256:abc123' },
          },
        }),
      ) as any;

      expect(c.tagFamily).toBe('loose');
      expect(c.imageVariant).toBe('v8');
      expect(c.imageDigestWatch).toBe(true);
      expect(c.imageTagSemver).toBe(true);
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

    it('maps runtime details from api payload', () => {
      const c = mapApiContainer(
        makeApiContainer({
          details: {
            ports: ['0.0.0.0:8080->80/tcp', '443/tcp'],
            volumes: ['config-vol:/config', '/host/data:/data:ro'],
            env: [
              { key: 'NODE_ENV', value: 'production' },
              { key: 'EMPTY', value: '' },
            ],
          },
        }),
      );
      expect(c.details.ports).toEqual(['0.0.0.0:8080->80/tcp', '443/tcp']);
      expect(c.details.volumes).toEqual(['config-vol:/config', '/host/data:/data:ro']);
      expect(c.details.env).toEqual([
        { key: 'NODE_ENV', value: 'production' },
        { key: 'EMPTY', value: '' },
      ]);
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
