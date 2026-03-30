vi.mock('@/services/image-icon', () => ({
  getEffectiveDisplayIcon: vi.fn((_display: string, image: string) => `icon-${image}`),
}));

import { computeSecurityDelta, mapApiContainer, mapApiContainers } from '@/utils/container-mapper';
import { daysToMs } from '@/utils/maturity-policy';

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

    it('capitalizes non-local watcher names when agent is absent', () => {
      const c = mapApiContainer(makeApiContainer({ agent: null, watcher: 'remote-host' }));
      expect(c.server).toBe('Remote-host');
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

    it('detects dockerhub from known docker registry hosts', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'custom', url: 'https://registry-1.docker.io/v2' },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('dockerhub');
    });

    it('does not treat docker.io substrings in non-matching hosts as dockerhub', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'custom', url: 'https://docker.io.evil.example/v2' },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('custom');
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

    it('detects ghcr from scheme-less registry urls', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'other', url: 'ghcr.io/v2' },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('ghcr');
    });

    it('does not treat ghcr subdomains as ghcr', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'custom', url: 'https://packages.ghcr.io/v2' },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('custom');
    });

    it('does not treat ghcr.io substrings in non-matching hosts as ghcr', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'custom', url: 'https://ghcr.io.evil.example/v2' },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('custom');
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

    it('returns custom when registry url cannot be parsed', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'custom', url: 'https://[::1' },
            name: 'img',
            tag: { value: 'latest' },
          },
        }),
      );
      expect(c.registry).toBe('custom');
      expect(c.registryName).toBe('custom');
      expect(c.registryUrl).toBe('https://[::1');
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

    it('returns null for unknown update kinds', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'manual', semverDiff: 'build' },
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

    it('ignores non-http release links', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'minor' },
          result: { tag: '1.26', link: 'ftp://example.com/changelog' },
        }),
      );
      expect((c as any).releaseLink).toBeUndefined();
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
      expect((c as any).noUpdateReason).toContain(
        'Strict tag-family policy filtered out 1 higher semver',
      );
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

    it('marks skipped tag updates when remote tag is in skipTags', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
            remoteValue: '1.26',
          },
          updatePolicy: {
            skipTags: ['1.26'],
          },
        }),
      );

      expect((c as any).updatePolicyState).toBe('skipped');
      expect((c as any).suppressedUpdateTag).toBe('1.26');
    });

    it('ignores non-object updatePolicy payloads', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
            remoteValue: '1.26',
          },
          updatePolicy: 'invalid-shape',
        }),
      );

      expect((c as any).updatePolicyState).toBeUndefined();
      expect((c as any).suppressedUpdateTag).toBeUndefined();
    });

    it('leaves update policy state undefined when snooze/skip do not match', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
            remoteValue: '1.26',
          },
          updatePolicy: {
            skipTags: ['1.25'],
            skipDigests: ['sha256:other'],
          },
        }),
      );

      expect((c as any).updatePolicyState).toBeUndefined();
      expect((c as any).suppressedUpdateTag).toBeUndefined();
    });

    it('does not mark snoozed updates when snoozeUntil is in the past', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
            remoteValue: '1.26',
          },
          updatePolicy: {
            snoozeUntil: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          },
        }),
      );

      expect((c as any).updatePolicyState).toBeUndefined();
      expect((c as any).suppressedUpdateTag).toBeUndefined();
    });

    it('marks updates as maturity-blocked when mature-only policy hides a fresh update', () => {
      const freshDate = new Date(Date.now() - daysToMs(2)).toISOString();
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
            remoteValue: '1.26',
          },
          result: { tag: '1.26' },
          updateDetectedAt: freshDate,
          updatePolicy: {
            maturityMode: 'mature',
          },
        }),
      );

      expect((c as any).updatePolicyState).toBe('maturity-blocked');
      expect((c as any).suppressedUpdateTag).toBe('1.26');
    });

    it('marks maturity-blocked when updateDetectedAt is missing', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
            remoteValue: '1.26',
          },
          result: { tag: '1.26' },
          updatePolicy: {
            maturityMode: 'mature',
          },
        }),
      );

      expect((c as any).updatePolicyState).toBe('maturity-blocked');
      expect((c as any).suppressedUpdateTag).toBe('1.26');
    });

    it('does not mark maturity-blocked when mature-only policy threshold is met', () => {
      const oldDate = new Date(Date.now() - daysToMs(10)).toISOString();
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
            remoteValue: '1.26',
          },
          result: { tag: '1.26' },
          updateDetectedAt: oldDate,
          updatePolicy: {
            maturityMode: 'mature',
            maturityMinAgeDays: 7,
          },
        }),
      );

      expect((c as any).updatePolicyState).toBeUndefined();
      expect((c as any).suppressedUpdateTag).toBeUndefined();
    });

    it('falls back to default maturity min age when configured threshold is out of bounds', () => {
      const oldDate = new Date(Date.now() - daysToMs(10)).toISOString();
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
            remoteValue: '1.26',
          },
          result: { tag: '1.26' },
          updateDetectedAt: oldDate,
          updatePolicy: {
            maturityMode: 'mature',
            maturityMinAgeDays: 366,
          },
        }),
      );

      expect((c as any).updatePolicyState).toBeUndefined();
      expect((c as any).suppressedUpdateTag).toBeUndefined();
    });

    it('falls back to result.digest for suppressed digest updates when remote digest is missing', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'digest',
            semverDiff: 'unknown',
          },
          result: { digest: 'sha256:from-result' },
          updatePolicy: {
            snoozeUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        }),
      );

      expect((c as any).updatePolicyState).toBe('snoozed');
      expect((c as any).suppressedUpdateTag).toBe('sha256:from-result');
    });

    it('returns undefined suppressed digest tag when no digest values are available', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'digest',
            semverDiff: 'unknown',
          },
          result: {},
          updatePolicy: {
            snoozeUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        }),
      );

      expect((c as any).updatePolicyState).toBe('snoozed');
      expect((c as any).suppressedUpdateTag).toBeUndefined();
    });

    it('falls back to result.tag for suppressed tag updates when remote tag is missing', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
          },
          result: { tag: '1.27' },
          updatePolicy: {
            snoozeUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        }),
      );

      expect((c as any).updatePolicyState).toBe('snoozed');
      expect((c as any).suppressedUpdateTag).toBe('1.27');
    });

    it('returns undefined suppressed tag when no tag values are available', () => {
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: false,
          updateKind: {
            kind: 'tag',
            semverDiff: 'minor',
          },
          result: {},
          updatePolicy: {
            snoozeUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        }),
      );

      expect((c as any).updatePolicyState).toBe('snoozed');
      expect((c as any).suppressedUpdateTag).toBeUndefined();
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

    it('maps imageCreated from api image.created when valid', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: { name: 'nginx', tag: { value: '1.0' }, created: '2025-06-15T10:00:00.000Z' },
        }),
      );
      expect(c.imageCreated).toBe('2025-06-15T10:00:00.000Z');
    });

    it('ignores invalid imageCreated values', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: { name: 'nginx', tag: { value: '1.0' }, created: 'bad-date' },
        }),
      );
      expect(c.imageCreated).toBeUndefined();
    });

    it('sets imageCreated to undefined when not provided', () => {
      const c = mapApiContainer(makeApiContainer({}));
      expect(c.imageCreated).toBeUndefined();
    });

    it('sets updateMaturity to fresh when update is recent', () => {
      const recentDate = new Date(Date.now() - 2 * 86_400_000).toISOString();
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'minor' },
          result: { tag: '2.0.0' },
          updateDetectedAt: recentDate,
        }),
      );
      expect(c.updateMaturity).toBe('fresh');
      expect(c.updateMaturityTooltip).toMatch(/^Available for 2 days?$/);
    });

    it('sets updateMaturity to settled when update is old', () => {
      const oldDate = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const c = mapApiContainer(
        makeApiContainer({
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'minor' },
          result: { tag: '2.0.0' },
          updateDetectedAt: oldDate,
        }),
      );
      expect(c.updateMaturity).toBe('settled');
      expect(c.updateMaturityTooltip).toMatch(/^Available for 14 days$/);
    });

    it('sets updateMaturity to null when no update available', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.updateMaturity).toBeNull();
      expect(c.updateMaturityTooltip).toBeUndefined();
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

    it('maps tagPrecision when present in API response', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'hub', url: 'https://registry-1.docker.io' },
            name: 'nginx',
            tag: { value: 'latest', tagPrecision: 'floating' },
          },
        }),
      );
      expect(c.tagPrecision).toBe('floating');
    });

    it('maps tagPrecision as specific when set', () => {
      const c = mapApiContainer(
        makeApiContainer({
          image: {
            registry: { name: 'hub', url: 'https://registry-1.docker.io' },
            name: 'nginx',
            tag: { value: '1.25.3', tagPrecision: 'specific' },
          },
        }),
      );
      expect(c.tagPrecision).toBe('specific');
    });

    it('leaves tagPrecision undefined when not present', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.tagPrecision).toBeUndefined();
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

    it('renders label key alone when value is null or undefined', () => {
      const c = mapApiContainer(
        makeApiContainer({ labels: { 'flag-a': null, 'flag-b': undefined, normal: 'val' } }),
      );
      expect(c.details.labels).toEqual(['flag-a', 'flag-b', 'normal=val']);
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

    it('preserves sensitive flag on env entries when present', () => {
      const c = mapApiContainer(
        makeApiContainer({
          details: {
            ports: [],
            volumes: [],
            env: [
              { key: 'DB_PASSWORD', value: '[REDACTED]', sensitive: true },
              { key: 'PATH', value: '/usr/local/bin', sensitive: false },
              { key: 'PLAIN', value: 'no-flag' },
            ],
          },
        }),
      );
      expect(c.details.env).toEqual([
        { key: 'DB_PASSWORD', value: '[REDACTED]', sensitive: true },
        { key: 'PATH', value: '/usr/local/bin', sensitive: false },
        { key: 'PLAIN', value: 'no-flag' },
      ]);
    });

    it('normalizes non-string runtime detail values and filters invalid env keys', () => {
      const c = mapApiContainer(
        makeApiContainer({
          id: null,
          name: null,
          image: {
            registry: null,
            tag: { value: '1.25' },
          },
          details: {
            env: [
              { key: 'OBJECT', value: { nested: true } },
              { key: 'EMPTY', value: undefined },
              { key: 123, value: 'ignored' },
            ],
          },
        }),
      );

      expect(c.id).toBe('');
      expect(c.name).toBe('');
      expect(c.image).toBe('');
      expect(c.registry).toBe('custom');
      expect(c.details.env).toEqual([
        { key: 'OBJECT', value: '[object Object]' },
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

  describe('deriveUpdateBouncer', () => {
    it('returns undefined when no updateScan exists', () => {
      const c = mapApiContainer(makeApiContainer({ security: { scan: null, updateScan: null } }));
      expect(c.updateBouncer).toBeUndefined();
    });

    it('returns blocked when updateScan status is blocked', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: {
            scan: null,
            updateScan: {
              status: 'blocked',
              summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
            },
          },
        }),
      );
      expect(c.updateBouncer).toBe('blocked');
    });

    it('returns unsafe when updateScan has high vulnerabilities', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: {
            scan: null,
            updateScan: {
              status: 'passed',
              summary: { critical: 0, high: 3, medium: 0, low: 0, unknown: 0 },
            },
          },
        }),
      );
      expect(c.updateBouncer).toBe('unsafe');
    });

    it('returns safe when updateScan is clean', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: {
            scan: null,
            updateScan: {
              status: 'passed',
              summary: { critical: 0, high: 0, medium: 2, low: 1, unknown: 0 },
            },
          },
        }),
      );
      expect(c.updateBouncer).toBe('safe');
    });

    it('marks update scan state as not-scanned when update scan status is not-scanned', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: {
            scan: null,
            updateScan: {
              status: 'not-scanned',
              summary: null,
            },
          },
        }),
      );
      expect(c.updateSecurityScanState).toBe('not-scanned');
    });
  });

  describe('computeSecurityDelta', () => {
    it('returns undefined when current summary is missing', () => {
      expect(
        computeSecurityDelta(undefined, { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 }),
      ).toBeUndefined();
    });

    it('returns undefined when update summary is missing', () => {
      expect(
        computeSecurityDelta({ unknown: 0, low: 0, medium: 0, high: 0, critical: 0 }, undefined),
      ).toBeUndefined();
    });

    it('computes correct delta when update fixes vulnerabilities', () => {
      const delta = computeSecurityDelta(
        { unknown: 0, low: 2, medium: 3, high: 1, critical: 1 },
        { unknown: 0, low: 1, medium: 1, high: 0, critical: 0 },
      );
      expect(delta).toEqual({
        fixed: 5,
        new: 0,
        unchanged: 0,
        fixedCritical: 1,
        fixedHigh: 1,
        newCritical: 0,
        newHigh: 0,
      });
    });

    it('computes correct delta when update introduces new vulnerabilities', () => {
      const delta = computeSecurityDelta(
        { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
        { unknown: 0, low: 0, medium: 1, high: 2, critical: 1 },
      );
      expect(delta).toEqual({
        fixed: 0,
        new: 4,
        unchanged: 0,
        fixedCritical: 0,
        fixedHigh: 0,
        newCritical: 1,
        newHigh: 2,
      });
    });

    it('computes mixed delta correctly', () => {
      const delta = computeSecurityDelta(
        { unknown: 0, low: 5, medium: 3, high: 2, critical: 1 },
        { unknown: 1, low: 3, medium: 4, high: 0, critical: 2 },
      );
      expect(delta).toEqual({
        fixed: 4,
        new: 3,
        unchanged: 0,
        fixedCritical: 0,
        fixedHigh: 2,
        newCritical: 1,
        newHigh: 0,
      });
    });
  });

  describe('mapApiContainer with update security fields', () => {
    it('populates update fields when updateScan is present', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: {
            scan: {
              status: 'passed',
              summary: { critical: 2, high: 1, medium: 0, low: 0, unknown: 0 },
            },
            updateScan: {
              status: 'passed',
              summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
            },
          },
        }),
      );
      expect(c.updateBouncer).toBe('safe');
      expect(c.updateSecurityScanState).toBe('scanned');
      expect(c.updateSecuritySummary).toEqual({
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        unknown: 0,
      });
      expect(c.securityDelta).toEqual({
        fixed: 3,
        new: 0,
        unchanged: 0,
        fixedCritical: 2,
        fixedHigh: 1,
        newCritical: 0,
        newHigh: 0,
      });
    });

    it('does not populate delta when only current scan exists', () => {
      const c = mapApiContainer(
        makeApiContainer({
          security: {
            scan: {
              status: 'passed',
              summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
            },
          },
        }),
      );
      expect(c.updateBouncer).toBeUndefined();
      expect(c.updateSecurityScanState).toBeUndefined();
      expect(c.updateSecuritySummary).toBeUndefined();
      expect(c.securityDelta).toBeUndefined();
    });
  });

  describe('suggestedTag', () => {
    it('maps suggestedTag from result', () => {
      const c = mapApiContainer(
        makeApiContainer({
          result: { tag: '2.0', suggestedTag: 'v1.25.3' },
          updateAvailable: true,
        }),
      );
      expect(c.suggestedTag).toBe('v1.25.3');
    });

    it('returns undefined when suggestedTag is missing', () => {
      const c = mapApiContainer(
        makeApiContainer({ result: { tag: '2.0' }, updateAvailable: true }),
      );
      expect(c.suggestedTag).toBeUndefined();
    });

    it('returns undefined when suggestedTag is empty string', () => {
      const c = mapApiContainer(
        makeApiContainer({ result: { tag: '2.0', suggestedTag: '  ' }, updateAvailable: true }),
      );
      expect(c.suggestedTag).toBeUndefined();
    });
  });

  describe('sourceRepo', () => {
    it('maps sourceRepo from API container', () => {
      const c = mapApiContainer(makeApiContainer({ sourceRepo: 'https://github.com/nginx/nginx' }));
      expect(c.sourceRepo).toBe('https://github.com/nginx/nginx');
    });

    it('returns undefined when sourceRepo is missing', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.sourceRepo).toBeUndefined();
    });
  });

  describe('releaseNotes', () => {
    it('maps complete releaseNotes from result', () => {
      const c = mapApiContainer(
        makeApiContainer({
          result: {
            tag: '2.0',
            releaseNotes: {
              title: 'Release 2.0',
              body: 'New features',
              url: 'https://github.com/org/repo/releases/tag/v2.0',
              publishedAt: '2026-01-15T00:00:00Z',
              provider: 'github',
            },
          },
          updateAvailable: true,
        }),
      );
      expect(c.releaseNotes).toEqual({
        title: 'Release 2.0',
        body: 'New features',
        url: 'https://github.com/org/repo/releases/tag/v2.0',
        publishedAt: '2026-01-15T00:00:00Z',
        provider: 'github',
      });
    });

    it('returns null when releaseNotes is missing', () => {
      const c = mapApiContainer(
        makeApiContainer({ result: { tag: '2.0' }, updateAvailable: true }),
      );
      expect(c.releaseNotes).toBeNull();
    });

    it('returns null when releaseNotes has missing required fields', () => {
      const c = mapApiContainer(
        makeApiContainer({
          result: {
            tag: '2.0',
            releaseNotes: { title: 'Release', body: '', url: '', publishedAt: '', provider: '' },
          },
          updateAvailable: true,
        }),
      );
      expect(c.releaseNotes).toBeNull();
    });

    it('returns null when result is null', () => {
      const c = mapApiContainer(makeApiContainer());
      expect(c.releaseNotes).toBeNull();
    });
  });
});
