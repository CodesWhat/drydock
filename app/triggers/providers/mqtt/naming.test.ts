import {
  getCanonicalContainerName,
  getContainerIdentitySlug,
  getSanitizedCanonicalContainerName,
  getSanitizedRawContainerName,
  getStaleSanitizedContainerNameCandidates,
} from './naming.js';

describe('naming', () => {
  describe('getCanonicalContainerName', () => {
    test('returns base name when container name is a recreated alias matching the container id', () => {
      expect(
        getCanonicalContainerName({
          id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
          name: '7ea6b8a42686_termix',
        }),
      ).toBe('termix');
    });

    test('returns original name when not an alias', () => {
      expect(
        getCanonicalContainerName({
          id: 'abc123def456',
          name: 'my-container',
        }),
      ).toBe('my-container');
    });

    test('returns empty string when name is not a string', () => {
      expect(getCanonicalContainerName({ id: 'abc', name: 123 })).toBe('');
    });

    test('returns empty string when name is undefined', () => {
      expect(getCanonicalContainerName({ id: 'abc' })).toBe('');
    });

    test('returns original name when hex prefix does not match container id', () => {
      expect(
        getCanonicalContainerName({
          id: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          name: '7ea6b8a42686_termix',
        }),
      ).toBe('7ea6b8a42686_termix');
    });

    test('returns original name when id is missing', () => {
      expect(getCanonicalContainerName({ name: '7ea6b8a42686_termix' })).toBe(
        '7ea6b8a42686_termix',
      );
    });
  });

  describe('getSanitizedCanonicalContainerName', () => {
    test('sanitizes dots to dashes in canonical name', () => {
      expect(getSanitizedCanonicalContainerName({ id: 'abc', name: 'my.container.name' })).toBe(
        'my-container-name',
      );
    });
  });

  describe('getSanitizedRawContainerName', () => {
    test('sanitizes dots to dashes', () => {
      expect(getSanitizedRawContainerName({ name: 'my.container' })).toBe('my-container');
    });
  });

  describe('getStaleSanitizedContainerNameCandidates', () => {
    test('returns alias name as stale when container has a canonical base name', () => {
      const result = getStaleSanitizedContainerNameCandidates({
        id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
        name: '7ea6b8a42686_termix',
      });
      expect(result).toContain('7ea6b8a42686_termix');
    });

    test('returns legacy alias candidate for non-alias containers', () => {
      const result = getStaleSanitizedContainerNameCandidates({
        id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
        name: 'termix',
      });
      expect(result).toContain('7ea6b8a42686_termix');
    });

    test('returns empty array when no stale candidates exist', () => {
      const result = getStaleSanitizedContainerNameCandidates({
        name: 'simple',
      });
      expect(result).toEqual([]);
    });

    test('returns empty array when id is too short for legacy alias', () => {
      const result = getStaleSanitizedContainerNameCandidates({
        id: 'short',
        name: 'simple',
      });
      expect(result).toEqual([]);
    });

    test('does not include legacy alias when it matches canonical name', () => {
      // Container name IS already the alias format and matches its own id
      // so canonical = baseName, and legacy = id[0:12]_baseName = the raw name itself
      // The raw name is already added as stale; legacy should not duplicate
      const result = getStaleSanitizedContainerNameCandidates({
        id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
        name: '7ea6b8a42686_termix',
      });
      // raw name (7ea6b8a42686_termix) is stale, legacy alias (7ea6b8a42686_termix) is same as raw
      expect(result).toEqual(['7ea6b8a42686_termix']);
      // Should not contain duplicates
      expect(new Set(result).size).toBe(result.length);
    });
  });

  describe('getContainerIdentitySlug', () => {
    test('returns the project.service pair when both compose labels are present', () => {
      expect(
        getContainerIdentitySlug({
          id: 'abc123',
          name: 'app_web_1',
          labels: {
            'com.docker.compose.project': 'myapp',
            'com.docker.compose.service': 'web',
          },
        }),
      ).toBe('myapp.web');
    });

    test('sanitizes dots to dashes in the compose project.service pair', () => {
      expect(
        getContainerIdentitySlug({
          id: 'abc123',
          name: 'app_web_1',
          labels: {
            'com.docker.compose.project': 'my.app',
            'com.docker.compose.service': 'web.one',
          },
        }),
      ).toBe('my-app.web-one');
    });

    /**
     * Review finding 4 (roadmap 7-STORE slice 10): before
     * `encodeIdentitySlugComponent` escaped a literal `-` distinctly from a
     * `.`, project `a.b` and project `a-b` both sanitised their dots/dashes
     * to the same `a-b`, so pairing either with service `c` produced the
     * identical slug `a-b-c` — two different Compose stacks colliding on one
     * state topic and one discovery topic.
     */
    test('does not collide a dotted project name with a dashed one that sanitizes the same way', () => {
      const dottedProject = getContainerIdentitySlug({
        id: 'abc123',
        name: 'app_web_1',
        labels: {
          'com.docker.compose.project': 'a.b',
          'com.docker.compose.service': 'c',
        },
      });
      const dashedProject = getContainerIdentitySlug({
        id: 'def456',
        name: 'app_web_2',
        labels: {
          'com.docker.compose.project': 'a-b',
          'com.docker.compose.service': 'c',
        },
      });

      expect(dottedProject).toBe('a-b.c');
      expect(dashedProject).toBe('a--b.c');
      expect(dottedProject).not.toBe(dashedProject);
    });

    test('falls back to the sanitized canonical name when compose labels are absent', () => {
      expect(
        getContainerIdentitySlug({
          id: 'abc123',
          name: 'my.container',
        }),
      ).toBe('my-container');
    });

    test('falls back to the sanitized canonical name when only one compose label is present', () => {
      expect(
        getContainerIdentitySlug({
          id: 'abc123',
          name: 'my-container',
          labels: { 'com.docker.compose.project': 'myapp' },
        }),
      ).toBe('my-container');
    });

    test('does not change across a rename when compose labels are present', () => {
      const before = getContainerIdentitySlug({
        id: 'abc123',
        name: 'app_web_1',
        labels: {
          'com.docker.compose.project': 'myapp',
          'com.docker.compose.service': 'web',
        },
      });
      const afterRename = getContainerIdentitySlug({
        id: 'abc123',
        name: 'app_web_renamed',
        labels: {
          'com.docker.compose.project': 'myapp',
          'com.docker.compose.service': 'web',
        },
      });
      expect(afterRename).toBe(before);
    });
  });
});
