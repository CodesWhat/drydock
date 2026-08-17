import type { Container } from '../../model/container.js';
import {
  doesReferenceMatchId,
  matchesTriggerReferenceList,
  parseIncludeOrIncludeTriggerString,
  splitAndTrimCommaSeparatedList,
} from './trigger-reference-matching.js';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    updateKind: { kind: 'unknown', semverDiff: 'unknown' },
    ...overrides,
  } as Container;
}

function containerWithSemverDiff(semverDiff: string): Container {
  return makeContainer({
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '1.1.0', semverDiff } as never,
  });
}

describe('trigger-reference-matching', () => {
  describe('splitAndTrimCommaSeparatedList', () => {
    test('splits, trims, and drops empty entries', () => {
      expect(splitAndTrimCommaSeparatedList(' a , b ,, c ')).toStrictEqual(['a', 'b', 'c']);
    });

    test('returns an empty array for an all-whitespace/comma string', () => {
      expect(splitAndTrimCommaSeparatedList(' , , ')).toStrictEqual([]);
    });
  });

  describe('parseIncludeOrIncludeTriggerString', () => {
    test('parses a bare name with default threshold', () => {
      expect(parseIncludeOrIncludeTriggerString('pushover')).toStrictEqual({
        id: 'pushover',
        threshold: 'all',
      });
    });

    test('parses a name:threshold pair', () => {
      expect(parseIncludeOrIncludeTriggerString('pushover:major')).toStrictEqual({
        id: 'pushover',
        threshold: 'major',
      });
    });

    test('trims whitespace around id and threshold', () => {
      expect(parseIncludeOrIncludeTriggerString('  docker.local : DIGEST  ')).toStrictEqual({
        id: 'docker.local',
        threshold: 'digest',
      });
    });

    test('falls back to all threshold when the candidate is unsupported', () => {
      expect(parseIncludeOrIncludeTriggerString('pushover:turbo')).toStrictEqual({
        id: 'pushover',
        threshold: 'all',
      });
    });

    test('ignores threshold entirely when multiple separators are present', () => {
      expect(parseIncludeOrIncludeTriggerString('docker.local:digest:extra')).toStrictEqual({
        id: 'docker.local',
        threshold: 'all',
      });
    });
  });

  describe('doesReferenceMatchId', () => {
    test('matches the full trigger id', () => {
      expect(doesReferenceMatchId('docker.update', 'docker.update')).toBe(true);
    });

    test('matches the trigger name alone', () => {
      expect(doesReferenceMatchId('update', 'docker.update')).toBe(true);
    });

    test('matches provider.name against a 3+ part trigger id', () => {
      expect(doesReferenceMatchId('docker.update', 'agent-1.docker.update')).toBe(true);
    });

    test('does not match an unrelated reference', () => {
      expect(doesReferenceMatchId('notify', 'docker.update')).toBe(false);
    });

    test('is case-insensitive', () => {
      expect(doesReferenceMatchId('DOCKER.UPDATE', 'docker.update')).toBe(true);
    });

    test('returns false when the trigger id has no name segment', () => {
      expect(doesReferenceMatchId('update', '')).toBe(false);
    });

    test('matches a single-segment trigger id against itself', () => {
      expect(doesReferenceMatchId('pushover', 'pushover')).toBe(true);
    });

    test('does not match a provider-qualified reference against a single-segment trigger id', () => {
      expect(doesReferenceMatchId('other.pushover', 'pushover')).toBe(false);
    });
  });

  describe('matchesTriggerReferenceList', () => {
    test('returns false when the reference list is undefined', () => {
      expect(matchesTriggerReferenceList('docker.update', undefined, makeContainer())).toBe(false);
    });

    test('returns false when the trigger id is not referenced', () => {
      expect(
        matchesTriggerReferenceList('docker.update', 'slack.default,other', makeContainer()),
      ).toBe(false);
    });

    test('returns true when referenced with the default (all) threshold', () => {
      expect(
        matchesTriggerReferenceList(
          'docker.update',
          'slack.default,docker.update',
          makeContainer(),
        ),
      ).toBe(true);
    });

    test('honors a per-reference threshold', () => {
      const container = containerWithSemverDiff('minor');
      // 'patch' only matches semverDiff outside major/minor — 'minor' is rejected.
      expect(matchesTriggerReferenceList('docker.update', 'docker.update:patch', container)).toBe(
        false,
      );
      // 'minor' matches anything that isn't major.
      expect(matchesTriggerReferenceList('docker.update', 'docker.update:minor', container)).toBe(
        true,
      );
    });

    test('is case-insensitive on the trigger id', () => {
      expect(matchesTriggerReferenceList('DOCKER.UPDATE', 'docker.update', makeContainer())).toBe(
        true,
      );
    });
  });
});
