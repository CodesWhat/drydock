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
});

describe('runRegistryWebhookDispatch', () => {
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
});
