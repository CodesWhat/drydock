const { mockGetState } = vi.hoisted(() => ({ mockGetState: vi.fn() }));

vi.mock('../../../registry/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../registry/index.js')>();
  return { ...actual, getState: mockGetState };
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

import { isFileSourcedContainer } from '../../../model/container.js';
import { buildFileContainer, getFileContainerId } from './file-container.js';

function createRegistry(id: string, domain: string) {
  return {
    name: id.split('.')[1],
    configuration: {},
    getId: () => id,
    match: (image: { registry: { url: string } }) => image.registry.url === domain,
    normalizeImage: (image: unknown) => image,
  };
}

beforeEach(() => {
  mockGetState.mockReturnValue({
    registry: {
      'hub.public': createRegistry('hub.public', 'docker.io'),
      'ghcr.public': createRegistry('ghcr.public', 'ghcr.io'),
    },
  });
});

describe('getFileContainerId', () => {
  test('is stable, scoped to the watcher and carries the file prefix', () => {
    const id = getFileContainerId('staging', 'nginx');

    expect(id).toBe(getFileContainerId('staging', 'nginx'));
    expect(id).not.toBe(getFileContainerId('staging', 'redis'));
    expect(id).not.toBe(getFileContainerId('ci', 'nginx'));
    expect(id).toMatch(/^file-[0-9a-f]{24}$/);
  });
});

describe('buildFileContainer', () => {
  test('builds a synthetic container that is marked as file sourced', () => {
    const container = buildFileContainer('staging', {
      name: 'nginx',
      image: 'nginx:1.25.3',
      labels: {},
    });

    expect(container).toMatchObject({
      id: getFileContainerId('staging', 'nginx'),
      name: 'nginx',
      displayName: 'nginx',
      watcher: 'staging',
      source: 'file',
      status: 'unknown',
      tagFamily: 'strict',
      result: { tag: '1.25.3' },
      updateAvailable: false,
      image: {
        name: 'nginx',
        registry: { name: 'hub.public' },
        tag: { value: '1.25.3', semver: true, tagPrecision: 'specific' },
        digest: { watch: false },
        isLocalImage: false,
      },
    });
    expect(container.agent).toBeUndefined();
    expect(isFileSourcedContainer(container)).toBe(true);
  });

  test('defaults the tag to latest and matches the registry by domain', () => {
    const container = buildFileContainer('staging', {
      name: 'app',
      image: 'ghcr.io/acme/app',
      labels: {},
    });

    expect(container.image).toMatchObject({
      name: 'acme/app',
      registry: { name: 'ghcr.public', url: 'ghcr.io' },
      tag: { value: 'latest', semver: false, tagPrecision: 'floating' },
    });
  });

  test('resolves dd labels the way discovered containers do', () => {
    const container = buildFileContainer('staging', {
      name: 'app',
      image: 'ghcr.io/acme/app:1.4.0',
      labels: {
        'dd.tag.include': '^1\\.',
        'dd.tag.exclude': 'rc',
        'dd.tag.transform': '^v(.*)$ => $1',
        'dd.tag.family': 'loose',
        'dd.display.name': 'Acme app',
        'dd.display.icon': 'mdi:rocket',
        'dd.link.template': 'https://example.com/${major}',
        'dd.registry.lookup.image': 'acme/other',
        'dd.notification.include': 'slack.team',
        'dd.notification.exclude': 'smtp.ops',
        'dd.action.include': 'docker.local',
        'dd.updatePolicy.skipTags': '1.5.0',
      },
    });

    expect(container).toMatchObject({
      includeTags: '^1\\.',
      excludeTags: 'rc',
      transformTags: '^v(.*)$ => $1',
      tagFamily: 'loose',
      displayName: 'Acme app',
      displayIcon: 'mdi:rocket',
      linkTemplate: 'https://example.com/${major}',
      notificationTriggerInclude: 'slack.team',
      notificationTriggerExclude: 'smtp.ops',
      actionTriggerInclude: 'docker.local',
      image: { registry: { lookupImage: 'acme/other' } },
      updatePolicy: { skipTags: ['1.5.0'] },
      labels: expect.objectContaining({ 'dd.display.name': 'Acme app' }),
    });
  });

  test('passes the logger through to the update policy resolution', () => {
    const logger = { warn: vi.fn() };

    buildFileContainer(
      'staging',
      { name: 'app', image: 'nginx:1', labels: { 'dd.updatePolicy.maturityMode': 'sometimes' } },
      logger,
    );

    expect(logger.warn).toHaveBeenCalled();
  });
});
