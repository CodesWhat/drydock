import type { ContainerInfo, ImageInfo } from 'dockerode';
import { describe, expect, test } from 'vitest';
import { buildImageInventory, estimateReclaimable, isPruneMode } from './inventory.js';

function makeImage(overrides: Partial<ImageInfo> = {}): ImageInfo {
  return {
    Id: 'sha256:image1',
    ParentId: '',
    RepoTags: ['repo:latest'],
    RepoDigests: ['repo@sha256:digest1'],
    Created: 1_700_000_000,
    Size: 1000,
    VirtualSize: 1000,
    SharedSize: 0,
    Labels: {},
    Containers: -1,
    ...overrides,
  };
}

function makeContainer(overrides: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
    Id: 'container1',
    Names: ['/container1'],
    Image: 'repo:latest',
    ImageID: 'sha256:image1',
    Command: 'true',
    Created: 1_700_000_500,
    Ports: [],
    Labels: {},
    State: 'running',
    Status: 'Up',
    HostConfig: { NetworkMode: 'default' },
    NetworkSettings: { Networks: {} },
    Mounts: [],
    ...overrides,
  };
}

describe('buildImageInventory', () => {
  test('returns an empty array for empty inputs', () => {
    expect(buildImageInventory([], [], { watcher: 'local' })).toEqual([]);
  });

  test('counts containers by matching ImageID, ignoring image.Containers', () => {
    const image = makeImage({ Id: 'sha256:used', Containers: -1 });
    const containers = [
      makeContainer({ Id: 'c1', ImageID: 'sha256:used' }),
      makeContainer({ Id: 'c2', ImageID: 'sha256:used' }),
      makeContainer({ Id: 'c3', ImageID: 'sha256:other' }),
    ];

    const [item] = buildImageInventory([image], containers, { watcher: 'local' });

    expect(item.containers).toBe(2);
  });

  test('reports zero containers when none match', () => {
    const image = makeImage({ Id: 'sha256:unused' });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.containers).toBe(0);
  });

  test('marks an image dangling when RepoTags is missing', () => {
    const image = makeImage({ RepoTags: undefined });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.dangling).toBe(true);
    expect(item.repoTags).toEqual([]);
  });

  test('marks an image dangling when RepoTags is empty', () => {
    const image = makeImage({ RepoTags: [] });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.dangling).toBe(true);
    expect(item.repoTags).toEqual([]);
  });

  test('marks an image dangling when every tag is <none>:<none>, and drops <none> digests', () => {
    const image = makeImage({
      RepoTags: ['<none>:<none>'],
      RepoDigests: ['<none>@<none>'],
    });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.dangling).toBe(true);
    expect(item.repoTags).toEqual([]);
    expect(item.repoDigests).toEqual([]);
  });

  test('marks an image not dangling when it has a real tag', () => {
    const image = makeImage({ RepoTags: ['repo:latest'] });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.dangling).toBe(false);
    expect(item.repoTags).toEqual(['repo:latest']);
  });

  test('computes reclaimable using SharedSize when it is a real positive value', () => {
    const image = makeImage({ Size: 1000, SharedSize: 400 });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.reclaimable).toBe(600);
  });

  test('computes reclaimable using the full size when SharedSize is -1', () => {
    const image = makeImage({ Size: 1000, SharedSize: -1 });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.reclaimable).toBe(1000);
  });

  test('computes reclaimable using the full size when SharedSize is undefined', () => {
    const image = makeImage({ Size: 1000, SharedSize: undefined as unknown as number });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.reclaimable).toBe(1000);
  });

  test('clamps reclaimable at zero when SharedSize exceeds Size', () => {
    const image = makeImage({ Size: 100, SharedSize: 500 });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.reclaimable).toBe(0);
  });

  test('sets lastSeen to the ISO of the latest matching container', () => {
    const image = makeImage({ Id: 'sha256:used' });
    const containers = [
      makeContainer({ Id: 'c1', ImageID: 'sha256:used', Created: 1_700_000_100 }),
      makeContainer({ Id: 'c2', ImageID: 'sha256:used', Created: 1_700_000_900 }),
    ];

    const [item] = buildImageInventory([image], containers, { watcher: 'local' });

    expect(item.lastSeen).toBe(new Date(1_700_000_900 * 1000).toISOString());
  });

  test('omits lastSeen when no containers use the image', () => {
    const image = makeImage({ Id: 'sha256:unused' });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.lastSeen).toBeUndefined();
  });

  test('sets created from Created seconds since epoch', () => {
    const image = makeImage({ Created: 1_700_000_000 });
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.created).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  test('includes agent when ctx.agent is set', () => {
    const image = makeImage();
    const [item] = buildImageInventory([image], [], { watcher: 'local', agent: 'agent-1' });

    expect(item.agent).toBe('agent-1');
    expect(item.watcher).toBe('local');
  });

  test('omits agent when ctx.agent is not set', () => {
    const image = makeImage();
    const [item] = buildImageInventory([image], [], { watcher: 'local' });

    expect(item.agent).toBeUndefined();
  });

  test('sorts by size descending, then by id ascending on a tie', () => {
    const images = [
      makeImage({ Id: 'sha256:b', Size: 500 }),
      makeImage({ Id: 'sha256:a', Size: 900 }),
      makeImage({ Id: 'sha256:z', Size: 900 }),
      makeImage({ Id: 'sha256:c', Size: 100 }),
    ];

    const items = buildImageInventory(images, [], { watcher: 'local' });

    expect(items.map((item) => item.id)).toEqual(['sha256:a', 'sha256:z', 'sha256:b', 'sha256:c']);
  });
});

describe('estimateReclaimable', () => {
  test('dangling mode counts only dangling images with no containers', () => {
    const items = buildImageInventory(
      [
        makeImage({ Id: 'sha256:dangling-unused', RepoTags: [], Size: 200, SharedSize: -1 }),
        makeImage({ Id: 'sha256:dangling-used', RepoTags: [], Size: 300, SharedSize: -1 }),
        makeImage({
          Id: 'sha256:tagged-unused',
          RepoTags: ['repo:latest'],
          Size: 400,
          SharedSize: -1,
        }),
      ],
      [makeContainer({ Id: 'c1', ImageID: 'sha256:dangling-used' })],
      { watcher: 'local' },
    );

    const estimate = estimateReclaimable(items, 'host-1', 'dangling');

    expect(estimate).toEqual({
      host: 'host-1',
      mode: 'dangling',
      images: 1,
      reclaimable: 200,
    });
  });

  test('unused mode counts every image with no containers regardless of dangling', () => {
    const items = buildImageInventory(
      [
        makeImage({ Id: 'sha256:dangling-unused', RepoTags: [], Size: 200, SharedSize: -1 }),
        makeImage({
          Id: 'sha256:tagged-unused',
          RepoTags: ['repo:latest'],
          Size: 400,
          SharedSize: -1,
        }),
        makeImage({ Id: 'sha256:tagged-used', RepoTags: ['repo:v2'], Size: 100, SharedSize: -1 }),
      ],
      [makeContainer({ Id: 'c1', ImageID: 'sha256:tagged-used' })],
      { watcher: 'local' },
    );

    const estimate = estimateReclaimable(items, 'host-1', 'unused');

    expect(estimate).toEqual({
      host: 'host-1',
      mode: 'unused',
      images: 2,
      reclaimable: 600,
    });
  });

  test('returns zero images and reclaimable for empty input', () => {
    const estimate = estimateReclaimable([], 'host-1', 'dangling');

    expect(estimate).toEqual({
      host: 'host-1',
      mode: 'dangling',
      images: 0,
      reclaimable: 0,
    });
  });
});

describe('isPruneMode', () => {
  test('accepts the known prune modes', () => {
    expect(isPruneMode('dangling')).toBe(true);
    expect(isPruneMode('unused')).toBe(true);
  });

  test('rejects anything else', () => {
    expect(isPruneMode('all')).toBe(false);
    expect(isPruneMode(undefined)).toBe(false);
    expect(isPruneMode(null)).toBe(false);
    expect(isPruneMode(42)).toBe(false);
  });
});
