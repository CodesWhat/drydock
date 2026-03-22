import { sanitizeLogParam } from '../../log/sanitize.js';

const { mockLogWarn } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
}));

vi.mock('../../log/index.js', () => ({
  default: {
    child: () => ({
      warn: mockLogWarn,
    }),
  },
}));

import {
  findContainersForImageReferences,
  runRegistryWebhookDispatch,
} from './registry-dispatch.js';

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'service',
    watcher: 'local',
    image: {
      registry: {
        url: 'https://registry-1.docker.io/v2',
      },
      name: 'library/nginx',
      tag: {
        value: '1.25.0',
      },
    },
    ...overrides,
  };
}

describe('findContainersForImageReferences', () => {
  test('matches containers by normalized image repository across registry aliases', () => {
    const containers = [
      createContainer({
        id: 'hub-container',
        image: {
          registry: {
            url: 'https://registry-1.docker.io/v2',
          },
          name: 'library/nginx',
          tag: {
            value: '1.25.0',
          },
        },
      }),
      createContainer({
        id: 'ghcr-container',
        image: {
          registry: {
            url: 'https://ghcr.io',
          },
          name: 'codeswhat/drydock',
          tag: {
            value: '1.4.0',
          },
        },
      }),
    ];

    const matches = findContainersForImageReferences(containers as any, [
      { image: 'nginx', tag: 'latest' },
      { image: 'ghcr.io/codeswhat/drydock', tag: '1.5.0' },
    ]);

    expect(matches.map((container) => container.id)).toStrictEqual([
      'hub-container',
      'ghcr-container',
    ]);
  });

  test('de-duplicates containers when multiple references match the same image', () => {
    const containers = [
      createContainer({
        id: 'hub-container',
      }),
    ];

    const matches = findContainersForImageReferences(containers as any, [
      { image: 'docker.io/library/nginx', tag: '1.25.0' },
      { image: 'registry-1.docker.io/library/nginx', tag: 'latest' },
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('hub-container');
  });

  test('returns empty matches when either side has no candidates', () => {
    expect(
      findContainersForImageReferences([] as any, [{ image: 'nginx', tag: 'latest' }]),
    ).toEqual([]);
    expect(findContainersForImageReferences([createContainer() as any], [])).toEqual([]);
  });

  test('handles malformed or non-string registry hosts and still matches by image name', () => {
    const containers = [
      createContainer({
        id: 'malformed-registry',
        image: {
          registry: {
            url: 'https://[broken-host',
          },
          name: 'library/nginx',
          tag: { value: 'latest' },
        },
      }),
      createContainer({
        id: 'missing-name',
        image: {
          registry: {
            url: 42,
          },
          tag: { value: 'latest' },
        },
      }),
    ];

    const matches = findContainersForImageReferences(containers as any, [
      { image: 'docker.io/library/nginx', tag: 'latest' },
    ]);

    expect(matches.map((container) => container.id)).toStrictEqual(['malformed-registry']);
  });

  test('normalizes bare registry hosts when protocol is missing', () => {
    const containers = [
      createContainer({
        id: 'bare-host',
        image: {
          registry: {
            url: 'registry-1.docker.io',
          },
          name: 'library/nginx',
          tag: { value: 'latest' },
        },
      }),
    ];

    const matches = findContainersForImageReferences(containers as any, [
      { image: 'docker.io/library/nginx', tag: 'latest' },
    ]);

    expect(matches.map((container) => container.id)).toStrictEqual(['bare-host']);
  });

  test('handles registry host fallback branches for unusual URL inputs', () => {
    const containers = [
      createContainer({
        id: 'file-url-host-fallback',
        image: {
          registry: {
            url: 'file:///tmp',
          },
          name: 'library/nginx',
          tag: { value: 'latest' },
        },
      }),
      createContainer({
        id: 'slash-host-fallback',
        image: {
          registry: {
            url: 'https:///',
          },
          name: 'library/nginx',
          tag: { value: 'latest' },
        },
      }),
    ];

    const matches = findContainersForImageReferences(containers as any, [
      { image: 'library/nginx', tag: 'latest' },
    ]);

    expect(matches.map((container) => container.id)).toStrictEqual([
      'file-url-host-fallback',
      'slash-host-fallback',
    ]);
  });
});

describe('runRegistryWebhookDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('triggers immediate checks and marks fresh containers for scheduled poll skip', async () => {
    const containerOne = createContainer({ id: 'one', watcher: 'local' });
    const containerTwo = createContainer({
      id: 'two',
      watcher: 'edge',
      agent: 'agent-1',
      image: {
        registry: {
          url: 'https://ghcr.io',
        },
        name: 'codeswhat/drydock',
        tag: {
          value: '1.4.0',
        },
      },
    });

    const watcherLocal = {
      watchContainer: vi.fn().mockResolvedValue(undefined),
    };
    const watcherAgent = {
      watchContainer: vi.fn().mockRejectedValue(new Error('watch failed')),
    };
    const markFresh = vi.fn();

    const result = await runRegistryWebhookDispatch({
      references: [
        { image: 'library/nginx', tag: 'latest' },
        { image: 'ghcr.io/codeswhat/drydock', tag: '1.5.0' },
      ],
      containers: [containerOne as any, containerTwo as any],
      watchers: {
        'docker.local': watcherLocal as any,
        'agent-1.docker.edge': watcherAgent as any,
      },
      markContainerFresh: markFresh,
    });

    expect(watcherLocal.watchContainer).toHaveBeenCalledWith(containerOne);
    expect(watcherAgent.watchContainer).toHaveBeenCalledWith(containerTwo);
    expect(markFresh).toHaveBeenCalledTimes(1);
    expect(markFresh).toHaveBeenCalledWith('one');

    expect(result).toStrictEqual({
      referencesMatched: 2,
      containersMatched: 2,
      checksTriggered: 1,
      checksFailed: 1,
      watchersMissing: 0,
    });
  });

  test('counts missing watchers without attempting checks', async () => {
    const container = createContainer({ id: 'one', watcher: 'local' });

    const result = await runRegistryWebhookDispatch({
      references: [{ image: 'library/nginx', tag: 'latest' }],
      containers: [container as any],
      watchers: {},
      markContainerFresh: vi.fn(),
    });

    expect(result).toStrictEqual({
      referencesMatched: 1,
      containersMatched: 1,
      checksTriggered: 0,
      checksFailed: 0,
      watchersMissing: 1,
    });
  });

  test('logs details when triggering an immediate check fails', async () => {
    const container = createContainer({
      id: 'one\nid',
      watcher: 'local\nwatcher',
    });
    const markFresh = vi.fn();
    const rawErrorMessage = 'daemon offline\nfatal';
    const watcher = {
      watchContainer: vi.fn().mockRejectedValue(new Error(rawErrorMessage)),
    };
    const watcherId = `docker.${container.watcher}`;

    const result = await runRegistryWebhookDispatch({
      references: [{ image: 'library/nginx', tag: 'latest' }],
      containers: [container as any],
      watchers: {
        [watcherId]: watcher as any,
      },
      markContainerFresh: markFresh,
    });

    expect(result).toStrictEqual({
      referencesMatched: 1,
      containersMatched: 1,
      checksTriggered: 0,
      checksFailed: 1,
      watchersMissing: 0,
    });
    expect(markFresh).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      `Error triggering immediate registry webhook check for container ${sanitizeLogParam(container.id)} via watcher ${sanitizeLogParam(watcherId)} (${sanitizeLogParam(rawErrorMessage)})`,
    );
  });
});
