import { createContainerFixture } from '../../../test/helpers.js';

// Only the store and the registry are doubled. Docker, image-comparison, tag-candidates and the
// tag module are the real ones, so this proves a stored rejected line reaches candidate selection.
const storeMocks = vi.hoisted(() => ({ getContainer: vi.fn() }));
const registryMocks = vi.hoisted(() => ({ getState: vi.fn() }));

vi.mock('../../../store/container.js', () => storeMocks);
vi.mock('../../../registry/index.js', () => registryMocks);

import Docker from './Docker.js';

const TAGS = ['2.0.0', '2.0.5', '2.1.0', '3.0.0', '3.2.1', '4.0.0', '4.1.0'];

function setup(storedSkipTags: string[] | undefined, current = '2.0.0') {
  storeMocks.getContainer.mockReturnValue(
    storedSkipTags ? { updatePolicy: { skipTags: storedSkipTags } } : undefined,
  );
  registryMocks.getState.mockReturnValue({
    registry: {
      registry: {
        normalizeImage: (image: unknown) => image,
        getTags: vi.fn().mockResolvedValue(TAGS),
      },
    },
  });
  const docker = new Docker();
  (docker as any).configuration = { tag: {}, imgset: {} };
  const container = createContainerFixture({
    image: {
      ...createContainerFixture().image,
      tag: { value: current, semver: true },
    },
  });
  const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return docker.findNewVersion(container as any, log);
}

describe('Docker.findNewVersion with a stored rejected line', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('without a stored skip the highest tag wins', async () => {
    expect((await setup(undefined)).tag).toBe('4.1.0');
  });

  test('a stored major:3 never yields a 3.x tag and still offers the best 4.x', async () => {
    const result = await setup(['major:3']);

    expect(result.tag).toBe('4.1.0');
    expect(storeMocks.getContainer).toHaveBeenCalledWith('container-123456789');
  });

  test('with 4.x rejected as well the best 2.x patch/minor is offered, never 3.x', async () => {
    const result = await setup(['major:3', 'major:4']);

    expect(result.tag).toBe('2.1.0');
  });

  test('a stored minor:4.1 falls back to the rest of the 4.x line', async () => {
    expect((await setup(['minor:4.1'])).tag).toBe('4.0.0');
  });

  test('rejecting the only newer lines leaves nothing newer than the current tag', async () => {
    const result = await setup(['major:3', 'major:4'], '2.1.0');

    expect(result.tag).toBe('2.1.0');
  });
});
