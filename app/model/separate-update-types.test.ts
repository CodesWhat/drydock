import { describe, expect, test } from 'vitest';
import { validate } from './container.js';
import {
  applySeparateUpdateTypes,
  isSeparateUpdateTypesEnabled,
  selectCandidateWithinThreshold,
} from './separate-update-types.js';

const allCandidates = {
  patch: { tag: '1.2.9', semverDiff: 'patch' },
  minor: { tag: '1.5.0', digest: 'sha256:minor', semverDiff: 'minor' },
  major: { tag: '3.0.0', semverDiff: 'major' },
};

function createContainer(overrides: Record<string, unknown> = {}, result: object = {}) {
  return validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: '1.2.3', semver: true },
      digest: { watch: false },
      architecture: 'arch',
      os: 'os',
    },
    result: {
      tag: '3.0.0',
      digest: 'sha256:primary',
      created: '2026-04-01T00:00:00.000Z',
      updateCandidates: allCandidates,
      ...result,
    },
    ...overrides,
  } as never);
}

describe('isSeparateUpdateTypesEnabled', () => {
  test('is true only for an explicit true', () => {
    expect(isSeparateUpdateTypesEnabled(undefined)).toBe(false);
    expect(isSeparateUpdateTypesEnabled({})).toBe(false);
    expect(isSeparateUpdateTypesEnabled({ configuration: { separateupdatetypes: false } })).toBe(
      false,
    );
    expect(isSeparateUpdateTypesEnabled({ configuration: { separateupdatetypes: true } })).toBe(
      true,
    );
  });
});

describe('selectCandidateWithinThreshold', () => {
  test('keeps the container when the primary reaches the threshold', () => {
    const container = createContainer();
    expect(selectCandidateWithinThreshold(container, 'all')).toBe(container);
    expect(selectCandidateWithinThreshold(container, 'major')).toBe(container);
  });

  test('offers the minor candidate when the threshold excludes a major primary', () => {
    const container = createContainer();
    const selected = selectCandidateWithinThreshold(container, 'minor');
    expect(selected).not.toBe(container);
    expect(selected.result?.tag).toBe('1.5.0');
    expect(selected.result?.digest).toBe('sha256:minor');
    expect(selected.result?.created).toBeUndefined();
    expect(selected.updateKind).toEqual({
      kind: 'tag',
      localValue: '1.2.3',
      remoteValue: '1.5.0',
      semverDiff: 'minor',
    });
    expect(selected.updateAvailable).toBe(true);
    expect(selected.result?.updateCandidates).toEqual(allCandidates);
    // The original is untouched.
    expect(container.result?.tag).toBe('3.0.0');
  });

  test('offers the patch candidate under a patch threshold without carrying the primary digest', () => {
    const selected = selectCandidateWithinThreshold(createContainer(), 'patch');
    expect(selected.result?.tag).toBe('1.2.9');
    expect(selected.result).not.toHaveProperty('digest');
    expect(selected.updateKind?.semverDiff).toBe('patch');
  });

  test('uses the minor-only threshold to pick exactly the minor candidate', () => {
    const selected = selectCandidateWithinThreshold(createContainer(), 'minor-only');
    expect(selected.result?.tag).toBe('1.5.0');
  });

  test('falls back to the next type when the preferred one is missing or skipped', () => {
    const container = createContainer(
      { updatePolicy: { skipTags: ['1.5.0'] } },
      { updateCandidates: { patch: allCandidates.patch, minor: allCandidates.minor } },
    );
    // Primary is still 3.0.0 (a major), so the minor is skipped and the patch is chosen.
    expect(selectCandidateWithinThreshold(container, 'minor').result?.tag).toBe('1.2.9');
  });

  test('keeps the container when no candidate fits the threshold', () => {
    const container = createContainer({}, { updateCandidates: { major: allCandidates.major } });
    expect(selectCandidateWithinThreshold(container, 'minor')).toBe(container);
  });

  test('keeps the container without candidates', () => {
    const container = createContainer({}, { updateCandidates: undefined });
    expect(selectCandidateWithinThreshold(container, 'minor')).toBe(container);
  });

  test('keeps a container that has no tag update', () => {
    const digestOnly = createContainer(
      { image: { ...createContainer().image, digest: { watch: true, value: 'sha256:old' } } },
      { tag: '1.2.3', digest: 'sha256:new' },
    );
    expect(digestOnly.updateKind.kind).toBe('digest');
    expect(selectCandidateWithinThreshold(digestOnly, 'minor')).toBe(digestOnly);
  });

  test('keeps a container whose update is suppressed', () => {
    const snoozed = createContainer({ updatePolicy: { snoozeUntil: '2999-01-01T00:00:00.000Z' } });
    expect(snoozed.updateAvailable).toBe(false);
    expect(selectCandidateWithinThreshold(snoozed, 'minor')).toBe(snoozed);
  });
});

describe('applySeparateUpdateTypes', () => {
  test('does nothing when the trigger did not opt in', () => {
    const container = createContainer();
    expect(applySeparateUpdateTypes(container, { configuration: { threshold: 'minor' } })).toBe(
      container,
    );
  });

  test('selects within the trigger threshold when it opted in', () => {
    const container = createContainer();
    const selected = applySeparateUpdateTypes(container, {
      configuration: { separateupdatetypes: true, threshold: 'MINOR' },
    });
    expect(selected.result?.tag).toBe('1.5.0');
  });

  test('defaults the threshold to all, which the primary always reaches', () => {
    const container = createContainer();
    expect(
      applySeparateUpdateTypes(container, { configuration: { separateupdatetypes: true } }),
    ).toBe(container);
    expect(applySeparateUpdateTypes(container, { configuration: {} } as never)).toBe(container);
    expect(applySeparateUpdateTypes(container, undefined)).toBe(container);
  });
});
