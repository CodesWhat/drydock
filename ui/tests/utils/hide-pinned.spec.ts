import type { Container } from '@/types/container';
import { filterContainersByHidePinned, matchesHidePinnedFilter } from '@/utils/hide-pinned';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'nginx',
    image: 'nginx:latest',
    icon: '',
    currentTag: 'latest',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    server: 'local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

describe('hide-pinned', () => {
  describe('matchesHidePinnedFilter', () => {
    it('returns true for all containers when hidePinned is disabled', () => {
      expect(matchesHidePinnedFilter(makeContainer({ tagPinned: true }), false)).toBe(true);
      expect(matchesHidePinnedFilter(makeContainer({ tagPinned: false }), false)).toBe(true);
    });

    it('returns false for pinned containers without a pending update when hidePinned is enabled', () => {
      expect(
        matchesHidePinnedFilter(
          makeContainer({
            currentTag: '16-alpine',
            tagPrecision: 'floating',
            tagPinned: true,
            newTag: null,
          }),
          true,
        ),
      ).toBe(false);
      expect(matchesHidePinnedFilter(makeContainer({ tagPinned: false }), true)).toBe(true);
      expect(matchesHidePinnedFilter(makeContainer(), true)).toBe(true);
    });

    it('returns true for pinned containers with a pending update (#293) when hidePinned is enabled', () => {
      // User pins a container to dodge a regression and still wants to see the
      // next upstream release as an available update. Hide Pinned must not
      // hide actionable pinned rows.
      expect(
        matchesHidePinnedFilter(
          makeContainer({
            id: 'grafana',
            currentTag: '12.3.2',
            tagPrecision: 'specific',
            tagPinned: true,
            newTag: '12.3.3',
          }),
          true,
        ),
      ).toBe(true);
    });
  });

  describe('filterContainersByHidePinned', () => {
    const containers = [
      makeContainer({ id: 'floating', name: 'floating', currentTag: 'latest', tagPinned: false }),
      makeContainer({
        id: 'pinned',
        name: 'pinned',
        currentTag: '16-alpine',
        tagPrecision: 'floating',
        tagPinned: true,
      }),
      makeContainer({
        id: 'pinned-with-update',
        name: 'grafana',
        currentTag: '12.3.2',
        tagPrecision: 'specific',
        tagPinned: true,
        newTag: '12.3.3',
      }),
      makeContainer({ id: 'unspecified', name: 'unspecified' }),
    ];

    it('returns all containers when hidePinned is disabled', () => {
      expect(
        filterContainersByHidePinned(containers, false).map((container) => container.id),
      ).toEqual(['floating', 'pinned', 'pinned-with-update', 'unspecified']);
    });

    it('filters only pinned containers without a pending update when hidePinned is enabled', () => {
      expect(
        filterContainersByHidePinned(containers, true).map((container) => container.id),
      ).toEqual(['floating', 'pinned-with-update', 'unspecified']);
    });
  });
});
