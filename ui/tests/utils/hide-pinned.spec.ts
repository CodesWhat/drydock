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

    it('returns false only for pinned containers when hidePinned is enabled', () => {
      expect(
        matchesHidePinnedFilter(
          makeContainer({ currentTag: '16-alpine', tagPrecision: 'floating', tagPinned: true }),
          true,
        ),
      ).toBe(false);
      expect(matchesHidePinnedFilter(makeContainer({ tagPinned: false }), true)).toBe(true);
      expect(matchesHidePinnedFilter(makeContainer(), true)).toBe(true);
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
      makeContainer({ id: 'unspecified', name: 'unspecified' }),
    ];

    it('returns all containers when hidePinned is disabled', () => {
      expect(
        filterContainersByHidePinned(containers, false).map((container) => container.id),
      ).toEqual(['floating', 'pinned', 'unspecified']);
    });

    it('filters only pinned containers when hidePinned is enabled', () => {
      expect(
        filterContainersByHidePinned(containers, true).map((container) => container.id),
      ).toEqual(['floating', 'unspecified']);
    });
  });
});
