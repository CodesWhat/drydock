import { beforeEach, describe, expect, test, vi } from 'vitest';

// End-to-end guard for the registry host lookalike leak: an image reference
// naming `evilghcr.io` must not route to the credentialed ghcr provider, and no
// request must leave for that host at all.

const { mockGetState, mockAxios } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockAxios: vi.fn(),
}));

vi.mock('axios', () => ({
  default: Object.assign(mockAxios, { isAxiosError: () => false }),
}));

vi.mock('../../../registry/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../registry/index.js')>();
  return {
    ...actual,
    getState: mockGetState,
  };
});

vi.mock('../../../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import Ghcr from '../../../registries/providers/ghcr/Ghcr.js';
import { findNewVersion, normalizeContainer } from './image-comparison.js';

const OPERATOR_CREDENTIAL = 'ghp_operator_personal_access_credential';

function createContainer(registryOverrides: Record<string, unknown>) {
  return {
    id: 'c1',
    name: 'victim',
    watcher: 'docker',
    image: {
      id: 'sha256:abc',
      registry: { name: 'ghcr', ...registryOverrides },
      name: 'victim-org/private',
      tag: { value: '1', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
  };
}

function createContainerLogger() {
  return { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe('registry lookalike routing', () => {
  let ghcr: Ghcr;

  beforeEach(async () => {
    vi.clearAllMocks();
    ghcr = new Ghcr();
    await ghcr.register('registry', 'ghcr', 'private', {
      username: 'operator',
      token: OPERATOR_CREDENTIAL,
    });
    mockGetState.mockReturnValue({ registry: { 'registry.ghcr.private': ghcr } });
  });

  test.each([
    ['no label, image pulled straight from the lookalike host', { url: 'evilghcr.io' }],
    [
      'dd.registry.lookup.image label naming the lookalike host',
      { url: 'ghcr.io', lookupImage: 'evilghcr.io/victim-org/private' },
    ],
  ])('routes to unknown and sends nothing: %s', async (_case, registryOverrides) => {
    const container = createContainer(registryOverrides);

    const normalized = normalizeContainer(container as never);

    expect(normalized.image.registry.name).toBe('unknown');

    const logContainer = createContainerLogger();
    await findNewVersion(normalized, logContainer);

    expect(logContainer.error).toHaveBeenCalledWith('Unsupported registry (unknown)');
    expect(mockAxios).not.toHaveBeenCalled();
  });

  test('still routes a genuine ghcr.io image to the credentialed provider', () => {
    const normalized = normalizeContainer(createContainer({ url: 'ghcr.io' }) as never);

    expect(normalized.image.registry.name).toBe('ghcr.private');
    expect(normalized.image.registry.url).toBe('https://ghcr.io/v2');
  });
});
