import DockerBase from '../docker/Docker.js';
import Portainer, {
  testable_extractTagVariable,
  testable_getComposeConfigFiles,
  testable_getComposeProjectPaths,
  testable_getServiceImage,
  testable_getServiceKey,
  testable_getTargetTag,
  testable_isMatchingServiceContainer,
  testable_isTargetServiceContainer,
  testable_normalizeImageReference,
  testable_normalizeImageRepository,
  testable_normalizeImplicitLatest,
  testable_normalizePath,
  testable_upsertStackEnv,
  testable_validateComposePullPolicy,
} from './Portainer.js';

vi.mock('../../../registry/index.js', () => ({
  getState: vi.fn(() => ({
    registry: {
      hub: {
        getImageFullName: (image, tag) => `${image.name}:${tag}`,
      },
    },
  })),
}));

function makeTrigger(options: { skipEndpointVerification?: boolean } = {}) {
  const trigger = new Portainer();
  trigger.configuration = {
    url: 'http://portainer.lan',
    apikey: 'secret',
    allowHttp: true,
    updateMode: 'auto',
    versionVarLabel: 'dd.portainer.version-var',
    updateModeLabel: 'dd.portainer.update-mode',
    pruneStack: false,
    redeployTimeout: 300000,
    dryrun: false,
    prune: false,
    autoremovetimeout: 10000,
    backupcount: 3,
  };
  trigger.log = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  if (options.skipEndpointVerification) {
    vi.spyOn(trigger, 'verifyPortainerEndpoint').mockResolvedValue(undefined);
  }
  return trigger;
}

function makeContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'container-id',
    name: 'pihole',
    watcher: 'local',
    labels: {
      'com.docker.compose.project': 'pihole',
      'com.docker.compose.project.working_dir': '/data/compose/12',
      'com.docker.compose.project.config_files': 'docker-compose.yml',
      'com.docker.compose.service': 'pihole',
    },
    image: {
      name: 'pihole/pihole',
      registry: { name: 'hub' },
      tag: { value: '2026.05.0' },
    },
    result: {
      tag: '2026.07.2',
    },
    updateKind: {
      kind: 'tag',
      localValue: '2026.05.0',
      remoteValue: '2026.07.2',
    },
    ...overrides,
  };
}

test('extractTagVariable detects a compose tag variable with fallback', () => {
  expect(testable_extractTagVariable('pihole/pihole:${PIHOLE_TAG:-2026.05.0}')).toBe('PIHOLE_TAG');
  expect(testable_extractTagVariable('registry:5000/app:${APP_TAG}')).toBe('APP_TAG');
  expect(testable_extractTagVariable('pihole/pihole:2026.05.0')).toBeUndefined();
  expect(testable_extractTagVariable(undefined)).toBeUndefined();
  expect(testable_extractTagVariable('pihole/pihole@sha256:abc')).toBeUndefined();
  expect(testable_extractTagVariable('pihole/pihole')).toBeUndefined();
});

test('Portainer defaults to HTTPS and normalizes the allowHttp alias', () => {
  const trigger = new Portainer();
  const secure = trigger.validateConfiguration({ url: 'https://portainer.lan', apikey: 'secret' });
  expect(secure.allowHttp).toBe(false);
  expect(() =>
    trigger.validateConfiguration({ url: 'http://portainer.lan', apikey: 'secret' }),
  ).toThrow();
  const internal = trigger.validateConfiguration({
    url: 'http://portainer.lan',
    apikey: 'secret',
    allowhttp: true,
  });
  expect(internal.allowHttp).toBe(true);
  expect(secure).not.toHaveProperty('pullImage');
  expect(() =>
    trigger.validateConfiguration({
      url: 'https://portainer.lan',
      apikey: 'secret',
      pullimage: true,
    }),
  ).toThrow();
});

test('Portainer rejects malformed endpoint labels and direct HTTP use', async () => {
  const trigger = makeTrigger();
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({ labels: { ...makeContainer().labels, 'dd.portainer.endpoint-id': 'abc' } }),
    ),
  ).rejects.toThrow('positive integer');
  trigger.configuration.allowHttp = false;
  expect(() => trigger.getPortainerUrl()).toThrow('allowHttp');
  trigger.configuration.redeployTimeout = 0;
  await expect(
    trigger.waitForPortainerRedeploy(
      { listContainers: vi.fn() },
      makeContainer(),
      makeResolvedUpdate(),
      trigger.log,
    ),
  ).rejects.toThrow('positive timeout');
});

test('getComposeProjectPaths resolves relative compose config files from working dir', () => {
  expect([
    ...testable_getComposeProjectPaths({
      'com.docker.compose.project.working_dir': '/data/compose/12',
      'com.docker.compose.project.config_files': 'docker-compose.yml,override.yml',
    }),
  ]).toEqual(['/data/compose/12']);
});

test('compose path helpers handle absent, absolute, and relative labels', () => {
  expect(testable_normalizePath(undefined)).toBeNull();
  expect(testable_normalizePath('   ')).toBeNull();
  expect(testable_normalizePath('/data/compose/../stack')).toBe('/data/stack');
  expect(testable_getComposeConfigFiles()).toEqual([]);
  expect(
    testable_getComposeConfigFiles({
      'com.docker.compose.project.config_files': '/tmp/compose.yml, override.yml',
    }),
  ).toEqual(['/tmp/compose.yml', 'override.yml']);
  expect(
    testable_getComposeConfigFiles({
      'com.docker.compose.project.config_files': 'one.yml,, two.yml',
    }),
  ).toEqual(['one.yml', 'two.yml']);
  expect(
    testable_getComposeProjectPaths({
      'com.docker.compose.project.config_files': '/tmp/compose.yml',
    }),
  ).toEqual(new Set(['/tmp']));
});

test('image and service helpers reject ambiguous or incomplete identity', () => {
  expect(testable_normalizeImplicitLatest(undefined)).toBeUndefined();
  expect(testable_normalizeImplicitLatest('repo/image@sha256:abc')).toBe('repo/image@sha256:abc');
  expect(testable_normalizeImplicitLatest('repo/image:stable')).toBe('repo/image:stable');
  expect(testable_normalizeImplicitLatest('repo/image')).toBe('repo/image:latest');
  expect(testable_normalizeImplicitLatest('/')).toBe('/:latest');
  const compose = { services: { app: { image: 'repo/image' }, empty: {}, scalar: 'bad' } };
  expect(
    testable_getServiceKey(compose, {
      labels: { 'com.docker.compose.project': 'demo', 'com.docker.compose.service': 'app' },
    }),
  ).toBe('app');
  expect(
    testable_getServiceKey(compose, {
      labels: { 'com.docker.compose.service': 'app' },
    }),
  ).toBeUndefined();
  expect(
    testable_getServiceKey(compose, {
      labels: { 'com.docker.compose.project': 'demo', 'com.docker.compose.service': 'missing' },
    }),
  ).toBeUndefined();
  expect(testable_getServiceImage(compose, 'empty')).toBeUndefined();
  expect(testable_getServiceImage(compose, 'scalar')).toBeUndefined();
  expect(testable_getServiceImage({ services: { app: { image: 3 } } }, 'app')).toBeUndefined();
  expect(testable_normalizeImageRepository(undefined)).toBeUndefined();
  expect(testable_normalizeImageRepository('/')).toBeUndefined();
  expect(testable_normalizeImageRepository('registry:5000/team/app:1')).toBe(
    'registry:5000/team/app',
  );
  expect(testable_normalizeImageRepository('docker.io/library/nginx:1')).toBe(
    'docker.io/library/nginx',
  );
  expect(testable_normalizeImageRepository('nginx:1')).toBe('docker.io/library/nginx');
  expect(testable_normalizeImageRepository('library/nginx:1')).toBe('docker.io/library/nginx');
  expect(testable_normalizeImageRepository('index.docker.io/nginx:1')).toBe(
    'docker.io/library/nginx',
  );
  expect(testable_normalizeImageRepository('registry-1.docker.io/library/nginx:1')).toBe(
    'docker.io/library/nginx',
  );
  expect(testable_normalizeImageRepository('ghcr.io/library/nginx:1')).toBe(
    'ghcr.io/library/nginx',
  );
  expect(testable_normalizeImageRepository('quay.io/library/nginx:1')).toBe(
    'quay.io/library/nginx',
  );
  expect(testable_normalizeImageRepository('localhost/library/nginx:1')).toBe(
    'localhost/library/nginx',
  );
  expect(testable_normalizeImageRepository('${REPO}/app:1')).toBeUndefined();
  expect(testable_normalizeImageReference(undefined)).toBeUndefined();
  expect(testable_normalizeImageReference('/')).toBeUndefined();
  expect(testable_normalizeImageReference('repo/image@sha256:ABC')).toBe(
    'docker.io/repo/image@sha256:abc',
  );
  expect(testable_normalizeImageReference('repo/image@')).toBeUndefined();
  expect(testable_normalizeImageReference('repo/image')).toBe('docker.io/repo/image:latest');
  expect(testable_normalizeImageReference('repo/image:$TAG')).toBeUndefined();
  expect(
    testable_validateComposePullPolicy({ services: { scalar: 'bad' } }, 'scalar', 'repo/image:1'),
  ).toBeUndefined();
  expect(() =>
    testable_validateComposePullPolicy(
      { services: { app: { image: 'repo/image:latest', pull_policy: 'missing' } } },
      'app',
      'repo/image:latest',
    ),
  ).toThrow('pull_policy');
});

test('replica identity requires exact project, service, running state, and image', () => {
  const resolved = { ...makeContainer(), service: 'app', targetImage: 'repo/app:latest' } as any;
  const container = { labels: { 'com.docker.compose.project': 'demo' } };
  expect(testable_isMatchingServiceContainer({ Labels: {} }, container, resolved)).toBe(false);
  expect(testable_isMatchingServiceContainer({}, container, resolved)).toBe(false);
  expect(testable_isTargetServiceContainer({}, container, resolved)).toBe(false);
  expect(
    testable_isTargetServiceContainer(
      {
        State: 'running',
        Image: 'repo/app:latest',
        ImageID: 'sha256:wrong',
        Labels: { 'com.docker.compose.project': 'demo', 'com.docker.compose.service': 'app' },
      },
      container,
      { ...resolved, targetImageId: 'sha256:right' },
    ),
  ).toBe(false);
  expect(
    testable_isTargetServiceContainer(
      {
        State: 'running',
        Image: 'repo/app:latest',
        ImageID: 'sha256:right',
        Labels: { 'com.docker.compose.project': 'demo', 'com.docker.compose.service': 'app' },
      },
      container,
      { ...resolved, targetImageId: 'sha256:right' },
    ),
  ).toBe(true);
  expect(
    testable_isTargetServiceContainer(
      {
        State: 'running',
        Image: 'repo/app:latest',
        Labels: { 'com.docker.compose.service': 'other' },
      },
      container,
      resolved,
    ),
  ).toBe(false);
  expect(
    testable_isTargetServiceContainer(
      {
        State: 'running',
        Image: 'repo/app:latest',
        Labels: { 'com.docker.compose.project': 'other', 'com.docker.compose.service': 'app' },
      },
      container,
      resolved,
    ),
  ).toBe(false);
  expect(
    testable_isTargetServiceContainer(
      {
        State: 'exited',
        Image: 'repo/app:latest',
        Labels: { 'com.docker.compose.project': 'demo', 'com.docker.compose.service': 'app' },
      },
      container,
      resolved,
    ),
  ).toBe(false);
});

test('upsertStackEnv replaces the configured version variable', () => {
  expect(
    testable_upsertStackEnv(
      [
        { name: 'APP_TAG', value: '1.0.0' },
        { name: 'OTHER', value: 'stable' },
      ],
      'APP_TAG',
      '1.1.0',
    ),
  ).toEqual([
    { name: 'OTHER', value: 'stable' },
    { name: 'APP_TAG', value: '1.1.0' },
  ]);
});

test('target tag helper prefers remote tags and rejects blank values', () => {
  expect(testable_getTargetTag({ updateKind: { remoteValue: '2.0.0' } })).toBe('2.0.0');
  expect(
    testable_getTargetTag({ updateKind: { remoteValue: ' ' }, result: { tag: '1.0.0' } }),
  ).toBe('1.0.0');
  expect(
    testable_getTargetTag({ updateKind: { remoteValue: '' }, result: { tag: ' ' } }),
  ).toBeUndefined();
  expect(testable_upsertStackEnv(undefined, 'APP_TAG', '1.0.0')).toEqual([
    { name: 'APP_TAG', value: '1.0.0' },
  ]);
});

test('resolvePortainerUpdate auto mode updates stack env when image tag uses a variable', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    {
      Id: 12,
      Name: 'pihole',
      EndpointId: 1,
      ProjectPath: '/data/compose/12',
    },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 1,
    ProjectPath: '/data/compose/12',
    Env: [{ name: 'PIHOLE_TAG', value: '2026.05.0' }],
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    [
      'services:',
      '  pihole:',
      '    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}',
      '    command: echo $$PIHOLE_TAG',
      '    healthcheck: ${OTHER_TAG:-$$PIHOLE_TAG}',
      '',
    ].join('\n'),
  );

  const update = await trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2026.07.2');

  expect(update.mode).toBe('env');
  expect(update.versionVar).toBe('PIHOLE_TAG');
  expect(update.updatedStackFileContent).toContain('${PIHOLE_TAG:-2026.05.0}');
  expect(update.updatedEnv).toEqual([{ name: 'PIHOLE_TAG', value: '2026.07.2' }]);
});

test('resolvePortainerUpdate env mode allows a selected image variable with a nested fallback', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 1,
    ProjectPath: '/data/compose/12',
    Env: [{ name: 'PIHOLE_TAG', value: '2026.05.0' }],
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-${DEFAULT_TAG:-2026.05.0}}',
  );

  const update = await trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2026.07.2');

  expect(update.mode).toBe('env');
  expect(update.versionVar).toBe('PIHOLE_TAG');
});

test.each([
  [
    'a sibling service image',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\n  other:\n    image: other/image:${PIHOLE_TAG}',
  ],
  [
    'a nested sibling service image fallback',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\n  other:\n    image: other/image:${OTHER_TAG:-${PIHOLE_TAG}}',
  ],
  [
    'a deeply nested sibling service image replacement',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\n  other:\n    image: other/image:${OTHER_TAG:+${OTHER_DEFAULT?${PIHOLE_TAG}}}',
  ],
  [
    'a nested sibling service image with a bare fallback reference',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\n  other:\n    image: other/image:${OTHER_TAG:-$PIHOLE_TAG}',
  ],
  [
    'a malformed nested sibling service image interpolation',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\n  other:\n    image: other/image:${OTHER_TAG:-${PIHOLE_TAG}',
  ],
  [
    'an invalid nested sibling service image interpolation',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\n  other:\n    image: other/image:${OTHER_TAG:-${}}',
  ],
  [
    'an unsupported nested sibling service image operator',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\n  other:\n    image: other/image:${OTHER_TAG:$PIHOLE_TAG}',
  ],
  [
    'a non-image service value',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\n    command:\n      - echo\n      - $PIHOLE_TAG\n    deploy:\n      replicas: 1',
  ],
  [
    'a top-level value',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\nx-version: ${PIHOLE_TAG}\nx-other: ${OTHER}',
  ],
  [
    'a nested non-image service value',
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}\n    command:\n      - ${OTHER_TAG:-${PIHOLE_TAG}}\n      - ${OTHER_TAG:-$}\n      - $PIHOLE_TAG\n      - $OTHER_DEFAULT\n      - $',
  ],
])(
  'resolvePortainerUpdate env mode rejects a variable also referenced by %s',
  async (_label, stackFile) => {
    const trigger = makeTrigger();
    vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
      { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
    ]);
    vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
      Id: 12,
      Name: 'pihole',
      EndpointId: 1,
      ProjectPath: '/data/compose/12',
      Env: [{ name: 'PIHOLE_TAG', value: '2026.05.0' }],
    });
    vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(stackFile);

    await expect(
      trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2026.07.2'),
    ).rejects.toThrow('must be referenced only by the selected service image tag');
  },
);

test('resolvePortainerUpdate env mode rejects a label variable that is not the selected image tag variable', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 1,
    ProjectPath: '/data/compose/12',
    Env: [{ name: 'PIHOLE_TAG', value: '2026.05.0' }],
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    'services:\n  pihole:\n    image: pihole/pihole:2026.05.0',
  );
  await expect(
    trigger.resolvePortainerUpdate(
      makeContainer({
        labels: {
          ...makeContainer().labels,
          'dd.portainer.update-mode': 'env',
          'dd.portainer.version-var': 'PIHOLE_TAG',
        },
      }),
      'pihole/pihole:2026.07.2',
    ),
  ).rejects.toThrow('must be referenced only by the selected service image tag');
});

test('resolvePortainerUpdate auto mode patches stack file when image tag is hardcoded', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    {
      Id: 13,
      Name: 'gitlab',
      EndpointId: 1,
      ProjectPath: '/data/compose/13',
    },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 13,
    Name: 'gitlab',
    EndpointId: 1,
    ProjectPath: '/data/compose/13',
    Env: [],
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    ['services:', '  runner:', '    image: gitlab/gitlab-runner:v19.0.0', ''].join('\n'),
  );

  const update = await trigger.resolvePortainerUpdate(
    makeContainer({
      name: 'gitlab-runner',
      labels: {
        'com.docker.compose.project': 'gitlab',
        'com.docker.compose.project.working_dir': '/data/compose/13',
        'com.docker.compose.project.config_files': 'docker-compose.yml',
        'com.docker.compose.service': 'runner',
      },
      image: {
        name: 'gitlab/gitlab-runner',
        registry: { name: 'hub' },
        tag: { value: 'v19.0.0' },
      },
      updateKind: {
        kind: 'tag',
        localValue: 'v19.0.0',
        remoteValue: 'v19.3.1',
      },
    }),
    'gitlab/gitlab-runner:v19.3.1',
  );

  expect(update.mode).toBe('compose');
  expect(update.updatedStackFileContent).toContain('image: gitlab/gitlab-runner:v19.3.1');
});

test('redeployPortainerStack sends the Portainer stack update payload', async () => {
  const trigger = makeTrigger();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({}),
  });
  vi.stubGlobal('fetch', fetchMock);

  await trigger.redeployPortainerStack({ Id: 12, Name: 'pihole', EndpointId: 1 }, 'services: {}', [
    { name: 'PIHOLE_TAG', value: '2026.07.2' },
  ]);

  expect(fetchMock).toHaveBeenCalledWith('http://portainer.lan/api/stacks/12?endpointId=1', {
    method: 'PUT',
    redirect: 'error',
    signal: expect.any(AbortSignal),
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'secret',
    },
    body: JSON.stringify({
      stackFileContent: 'services: {}',
      env: [{ name: 'PIHOLE_TAG', value: '2026.07.2' }],
      prune: false,
      pullImage: false,
    }),
  });

  vi.unstubAllGlobals();
});

test('waitForPortainerRedeploy resolves when the compose service reaches the target image', async () => {
  const trigger = makeTrigger();
  const dockerApi = {
    listContainers: vi
      .fn()
      .mockResolvedValueOnce([
        {
          Image: 'homeassistant/home-assistant:2026.7.1',
          Labels: {
            'com.docker.compose.project': 'openhab',
            'com.docker.compose.service': 'homeassistant',
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          Id: 'new-container-id',
          Names: ['/homeassistant'],
          State: 'running',
          ImageID: 'sha256:target',
          Image: 'homeassistant/home-assistant:2026.8.3',
          Labels: {
            'com.docker.compose.project': 'openhab',
            'com.docker.compose.service': 'homeassistant',
          },
        },
      ]),
  };
  const container = makeContainer({
    name: 'homeassistant',
    labels: {
      'com.docker.compose.project': 'openhab',
      'com.docker.compose.service': 'homeassistant',
    },
  });

  await trigger.waitForPortainerRedeploy(
    dockerApi,
    container,
    {
      mode: 'compose',
      stack: { Id: 2, Name: 'openhab', EndpointId: 1 },
      stackFileContent: '',
      service: 'homeassistant',
      targetImage: 'homeassistant/home-assistant:2026.8.3',
      targetImageId: 'sha256:target',
      updatedStackFileContent: '',
      updatedEnv: [],
    },
    trigger.log,
  );

  expect(dockerApi.listContainers).toHaveBeenCalledTimes(2);
});

test('waitForPortainerRedeploy rejects when Portainer never recreates the service', async () => {
  vi.useFakeTimers();
  const trigger = makeTrigger();
  trigger.configuration.redeployTimeout = 1;
  const dockerApi = {
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        Image: 'homeassistant/home-assistant:2026.7.1',
        Labels: {
          'com.docker.compose.project': 'openhab',
          'com.docker.compose.service': 'homeassistant',
        },
      },
    ]),
  };
  const container = makeContainer({
    name: 'homeassistant',
    labels: {
      'com.docker.compose.project': 'openhab',
      'com.docker.compose.service': 'homeassistant',
    },
  });

  const waitPromise = expect(
    trigger.waitForPortainerRedeploy(
      dockerApi,
      container,
      {
        mode: 'compose',
        stack: { Id: 2, Name: 'openhab', EndpointId: 1 },
        stackFileContent: '',
        service: 'homeassistant',
        targetImage: 'homeassistant/home-assistant:2026.8.3',
        updatedStackFileContent: '',
        updatedEnv: [],
      },
      trigger.log,
    ),
  ).rejects.toThrow(
    'Timed out waiting for Portainer stack openhab service homeassistant to use homeassistant/home-assistant:2026.8.3',
  );
  await vi.advanceTimersByTimeAsync(2000);
  await waitPromise;

  vi.useRealTimers();
});

test('resolvePortainerUpdate rejects digest updates before contacting Portainer', async () => {
  const trigger = makeTrigger();
  const container = makeContainer({ updateKind: { kind: 'digest' } });
  await expect(
    trigger.resolvePortainerUpdate(container, 'pihole/pihole:2026.07.2'),
  ).rejects.toThrow('Portainer provider only supports tag updates');
});

test('resolvePortainerUpdate requires compose project and service labels', async () => {
  const trigger = makeTrigger();
  await expect(
    trigger.resolvePortainerUpdate(
      makeContainer({
        labels: { 'com.docker.compose.project': 'pihole' },
      }),
      'pihole/pihole:2026.07.2',
    ),
  ).rejects.toThrow('compose project and service identity labels');
});

test('resolvePortainerStack filters endpoint and rejects ambiguous path matches', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
    { Id: 13, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
    { Id: 14, Name: 'pihole', EndpointId: 2, ProjectPath: '/data/compose/12' },
  ]);
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({
        labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
          'com.docker.compose.project.working_dir': '/data/compose/12',
          'dd.portainer.endpoint-id': '1',
        },
      }),
    ),
  ).rejects.toThrow('unambiguous');
});

test('resolvePortainerStack rejects invalid and mismatched endpoint labels', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 2, ProjectPath: '/data/compose/12' },
  ]);
  const labels = {
    'com.docker.compose.project': 'pihole',
    'com.docker.compose.service': 'pihole',
    'com.docker.compose.project.working_dir': '/data/compose/12',
  };
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({ labels: { ...labels, 'dd.portainer.endpoint-id': '0' } }),
    ),
  ).rejects.toThrow('positive integer');
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({ labels: { ...labels, 'dd.portainer.endpoint-id': '1' } }),
    ),
  ).rejects.toThrow('Unable to resolve Portainer stack');
});

test('resolvePortainerStack never overwrites the stack endpoint', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 2, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 2,
    ProjectPath: '/data/compose/12',
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue('services: {}');
  const resolved = await trigger.resolvePortainerStack(
    makeContainer({
      labels: {
        'com.docker.compose.project': 'pihole',
        'com.docker.compose.service': 'pihole',
        'com.docker.compose.project.working_dir': '/data/compose/12',
        'dd.portainer.endpoint-id': '2',
      },
    }),
  );
  expect(resolved.stack.EndpointId).toBe(2);
});

test('resolvePortainerStack rejects explicit endpoint mismatch and falls back from a missing stack id', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 2, ProjectPath: '/data/compose/12' },
  ]);
  const baseLabels = {
    'com.docker.compose.project': 'pihole',
    'com.docker.compose.service': 'pihole',
    'com.docker.compose.project.working_dir': '/data/compose/12',
  };
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({
        labels: { ...baseLabels, 'dd.portainer.stack-id': '12', 'dd.portainer.endpoint-id': '1' },
      }),
    ),
  ).rejects.toThrow('does not belong to endpoint 1');
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 2,
    ProjectPath: '/data/compose/12',
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue('services: {}');
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({ labels: { ...baseLabels, 'dd.portainer.stack-id': '99' } }),
    ),
  ).resolves.toMatchObject({ stack: { Id: 12 } });
});

test('resolvePortainerStack uses an explicit stack id only after project and path binding', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 2, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 2,
    ProjectPath: '/data/compose/12',
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue('services: {}');
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({
        labels: {
          ...makeContainer().labels,
          'dd.portainer.stack-id': '12',
        },
      }),
    ),
  ).resolves.toMatchObject({ stack: { Id: 12 } });
});

test.each([
  ['project name', { Name: 'other', ProjectPath: '/data/compose/12' }],
  ['project path', { Name: 'pihole', ProjectPath: '/data/compose/other' }],
])('resolvePortainerStack rejects explicit stack ids without %s binding', async (_label, stack) => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([{ Id: 12, EndpointId: 1, ...stack }]);
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({ labels: { ...makeContainer().labels, 'dd.portainer.stack-id': '12' } }),
    ),
  ).rejects.toThrow('Unable to resolve Portainer stack');
});

test('resolvePortainerStack safely falls back to the sole bound stack when an explicit id is stale', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 1,
    ProjectPath: '/data/compose/12',
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue('services: {}');
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({ labels: { ...makeContainer().labels, 'dd.portainer.stack-id': '99' } }),
    ),
  ).resolves.toMatchObject({ stack: { Id: 12 } });
});

test.each([
  ['WorkflowID', { WorkflowID: 42 }],
  ['GitConfig', { GitConfig: {} }],
  ['legacy AutoUpdate', { AutoUpdate: { RepositoryURL: 'https://git.example/stack.git' } }],
  [
    'current deployment source',
    { CurrentDeploymentInfo: { RepositoryURL: 'https://git.example/stack.git' } },
  ],
])(
  'resolvePortainerStack rejects Git-backed stacks marked by %s before fetching the stack file',
  async (_label, marker) => {
    const trigger = makeTrigger();
    vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
      { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
    ]);
    vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
      Id: 12,
      Name: 'pihole',
      EndpointId: 1,
      ProjectPath: '/data/compose/12',
      ...marker,
    });
    const stackFile = vi.spyOn(trigger, 'getPortainerStackFile');
    await expect(trigger.resolvePortainerStack(makeContainer())).rejects.toThrow(
      'Git-backed Portainer stacks cannot be updated',
    );
    expect(stackFile).not.toHaveBeenCalled();
  },
);

test('resolvePortainerStack rejects endpoint mismatch returned by stack details', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({ Id: 12, EndpointId: 2 });
  await expect(
    trigger.resolvePortainerStack(
      makeContainer({ labels: { ...makeContainer().labels, 'dd.portainer.endpoint-id': '1' } }),
    ),
  ).rejects.toThrow('does not belong to endpoint 1');
});

test('resolvePortainerStack rejects project binding changes returned by stack details', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'other',
    EndpointId: 1,
    ProjectPath: '/data/compose/12',
  });
  await expect(trigger.resolvePortainerStack(makeContainer())).rejects.toThrow(
    'Unable to resolve Portainer stack',
  );
});

test('resolvePortainerUpdate rejects unavailable env targets', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({ Id: 12, EndpointId: 1, Env: [] });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    'services:\n  pihole:\n    image: pihole/pihole:${PIHOLE_TAG:-1.0.0}',
  );
  const container = makeContainer({
    labels: {
      'com.docker.compose.project': 'pihole',
      'com.docker.compose.service': 'pihole',
      'dd.portainer.update-mode': 'env',
      'dd.portainer.version-var': 'PIHOLE_TAG',
      'com.docker.compose.project.working_dir': '/data/compose/12',
    },
    updateKind: { kind: 'tag', remoteValue: '' },
    result: { tag: '' },
  });
  await expect(trigger.resolvePortainerUpdate(container, 'pihole/pihole:2.0.0')).rejects.toThrow(
    'requires a tag update target',
  );
});

test('resolvePortainerUpdate reports missing service and version configuration', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({ Id: 12, EndpointId: 1, Env: [] });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue('services:\n  other: {}');
  await expect(
    trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2.0.0'),
  ).rejects.toThrow('Unable to resolve Portainer stack service');
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    'services:\n  pihole:\n    image: pihole/pihole:1.0.0',
  );
  const envContainer = makeContainer({
    labels: { ...makeContainer().labels, 'dd.portainer.update-mode': 'env' },
  });
  await expect(trigger.resolvePortainerUpdate(envContainer, 'pihole/pihole:2.0.0')).rejects.toThrow(
    'requires dd.portainer.version-var',
  );
});

test('resolvePortainerUpdate defaults compose env when stack details omit it', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({ Id: 12, EndpointId: 1 });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    'services:\n  pihole:\n    image: pihole/pihole:1.0.0',
  );
  const resolved = await trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2.0.0');
  expect(resolved.updatedEnv).toEqual([]);
});

test('resolvePortainerUpdate rejects a service without an image', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({ Id: 12, EndpointId: 1 });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue('services:\n  pihole: {}');
  await expect(
    trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2.0.0'),
  ).rejects.toThrow('has no image repository');
});

test('portainerFetch rejects redirects and omits response bodies from errors', async () => {
  const trigger = makeTrigger();
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: vi.fn() });
  vi.stubGlobal('fetch', fetchMock);
  await expect(trigger.portainerFetch('/api/stacks')).rejects.toThrow(
    'Portainer API request /api/stacks failed with HTTP 403',
  );
  expect(fetchMock.mock.calls[0][1]).toEqual(
    expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
  );
  vi.unstubAllGlobals();
});

test('Portainer API helpers handle JSON and no-content responses', async () => {
  const trigger = makeTrigger();
  expect(trigger.maskConfiguration()).toEqual(expect.any(Object));
  const json = vi.fn().mockResolvedValue({ Id: 12 });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json });
  vi.stubGlobal('fetch', fetchMock);
  await expect(trigger.getPortainerStacks()).resolves.toEqual({ Id: 12 });
  await expect(trigger.getPortainerStack(12)).resolves.toEqual({ Id: 12 });
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ StackFileContent: 'services: {}' }),
  });
  await expect(trigger.getPortainerStackFile(12)).resolves.toBe('services: {}');
  fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json });
  await expect(trigger.portainerFetch('/api/stacks')).resolves.toBeUndefined();
  vi.unstubAllGlobals();
});

test.each([
  ['mismatched container identity', { Id: 'different-container-id' }],
  ['unavailable endpoint proxy', undefined],
])('performContainerUpdate fails closed on %s', async (_label, proxyResponse) => {
  const trigger = makeTrigger();
  trigger.configuration.dryrun = true;
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  const pull = vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  vi.spyOn(trigger, 'portainerFetch').mockImplementation(async () => {
    if (proxyResponse === undefined) {
      throw new Error('endpoint proxy unavailable');
    }
    return {
      Id: 'different-container-id',
      Image: 'sha256:old',
      Config: { Image: 'pihole/pihole:2026.05.0' },
      State: { Running: true, Status: 'running' },
      ...proxyResponse,
    } as never;
  });
  await expect(
    trigger.performContainerUpdate(
      {
        dockerApi: {
          getImage: vi.fn().mockReturnValue({
            inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
          }),
        },
        currentContainerSpec: {
          Id: 'container-id',
          Image: 'sha256:old',
          Config: { Image: 'pihole/pihole:2026.05.0' },
          State: { Running: true, Status: 'running' },
        },
        newImage: resolved.targetImage,
      },
      makeContainer(),
      trigger.log,
    ),
  ).rejects.toThrow('Portainer endpoint');
  expect(pull).not.toHaveBeenCalled();
});

test('performContainerUpdate queries the selected Portainer endpoint proxy before pulling', async () => {
  const trigger = makeTrigger();
  trigger.configuration.dryrun = true;
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  const portainerFetch = vi.spyOn(trigger, 'portainerFetch').mockResolvedValue({
    Id: 'container-id',
    Image: 'sha256:old',
    Config: { Image: 'pihole/pihole:2026.05.0' },
    State: { Running: true, Status: 'running' },
  } as never);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  const dockerApi = {
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
    }),
  };
  await trigger.performContainerUpdate(
    {
      dockerApi,
      currentContainerSpec: {
        Id: 'container-id',
        Image: 'sha256:old',
        Config: { Image: 'pihole/pihole:2026.05.0' },
        State: { Running: true, Status: 'running' },
      },
      newImage: resolved.targetImage,
    },
    makeContainer(),
    trigger.log,
  );
  expect(portainerFetch).toHaveBeenCalledWith(
    '/api/endpoints/1/docker/containers/container-id/json',
  );
});

test('Portainer never asks Portainer to pull a second time', async () => {
  const trigger = makeTrigger();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn() });
  vi.stubGlobal('fetch', fetchMock);
  await trigger.redeployPortainerStack({ Id: 12, EndpointId: 1 }, 'services: {}', []);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).pullImage).toBe(false);
  vi.unstubAllGlobals();
});

test('capturePulledImageId accepts Docker image IDs and fallback id casing', async () => {
  const trigger = makeTrigger();
  await expect(
    trigger.capturePulledImageId(
      {
        getImage: vi
          .fn()
          .mockReturnValue({ inspect: vi.fn().mockResolvedValue({ id: 'sha256:old' }) }),
      },
      'pihole/pihole:1.0.0',
    ),
  ).resolves.toBe('sha256:old');
});

test('capturePulledImageId fails closed when Docker inspect is unavailable or has no ID', async () => {
  const trigger = makeTrigger();
  await expect(trigger.capturePulledImageId(undefined, 'pihole/pihole:2.0.0')).rejects.toThrow(
    'getImage is unavailable',
  );
  await expect(
    trigger.capturePulledImageId(
      { getImage: vi.fn().mockReturnValue({ inspect: vi.fn().mockResolvedValue({}) }) },
      'pihole/pihole:2.0.0',
    ),
  ).rejects.toThrow('image ID is unavailable');
});

test('Portainer rejects a service mapped to a different image repository', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 1,
    ProjectPath: '/data/compose/12',
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    'services:\n  pihole:\n    image: other/image:latest',
  );
  await expect(
    trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2026.07.2'),
  ).rejects.toThrow('image repository');
});

test('Portainer rejects same-path services from different registries', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 1,
    ProjectPath: '/data/compose/12',
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    'services:\n  pihole:\n    image: ghcr.io/pihole/pihole:latest',
  );
  await expect(
    trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2026.07.2'),
  ).rejects.toThrow('image repository');
});

test.each(['always', 'every_1h', 'build'])(
  'Portainer rejects Compose pull_policy %s before update',
  async (pullPolicy) => {
    const trigger = makeTrigger();
    vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
      { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
    ]);
    vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
      Id: 12,
      Name: 'pihole',
      EndpointId: 1,
      ProjectPath: '/data/compose/12',
    });
    vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
      `services:\n  pihole:\n    image: pihole/pihole:latest\n    pull_policy: ${pullPolicy}`,
    );
    await expect(
      trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2026.07.2'),
    ).rejects.toThrow('pull_policy');
  },
);

test.each([undefined, 'missing', 'never', 'if_not_present'])(
  'Portainer allows safe Compose pull_policy %s',
  async (pullPolicy) => {
    const trigger = makeTrigger();
    vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
      { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
    ]);
    vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
      Id: 12,
      Name: 'pihole',
      EndpointId: 1,
      ProjectPath: '/data/compose/12',
    });
    const policy = pullPolicy ? `\n    pull_policy: ${pullPolicy}` : '';
    vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
      `services:\n  pihole:\n    image: pihole/pihole:stable${policy}`,
    );
    await expect(
      trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2026.07.2'),
    ).resolves.toMatchObject({ service: 'pihole' });
  },
);

test.each([
  ['bare interpolation', '$TAG'],
  ['$TAG', 'pihole/pihole:$TAG'],
  ['default interpolation', 'pihole/pihole:${TAG-default}'],
  ['error interpolation', 'pihole/pihole:${TAG?error}'],
  ['repository interpolation', '${REPO}/pihole:${TAG}'],
])('Portainer rejects unsupported Compose interpolation (%s)', async (_name, image) => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'pihole', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  vi.spyOn(trigger, 'getPortainerStack').mockResolvedValue({
    Id: 12,
    Name: 'pihole',
    EndpointId: 1,
    ProjectPath: '/data/compose/12',
  });
  vi.spyOn(trigger, 'getPortainerStackFile').mockResolvedValue(
    `services:\n  pihole:\n    image: ${image}`,
  );
  await expect(
    trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2026.07.2'),
  ).rejects.toThrow('interpolation');
});

test('Portainer requires exact stack name when inferring by compose project path', async () => {
  const trigger = makeTrigger();
  vi.spyOn(trigger, 'getPortainerStacks').mockResolvedValue([
    { Id: 12, Name: 'different', EndpointId: 1, ProjectPath: '/data/compose/12' },
  ]);
  await expect(trigger.resolvePortainerStack(makeContainer())).rejects.toThrow(
    'Unable to resolve Portainer stack',
  );
});

test('Portainer lifecycle rejects non-tag updates before inherited preparation', async () => {
  const trigger = makeTrigger();
  const container = makeContainer({ updateKind: { kind: 'digest' } });
  await expect(trigger.runContainerUpdateLifecycle(container)).rejects.toThrow(
    'Portainer provider only supports tag updates',
  );
});

test('Portainer pre-runtime lifecycle rejects non-tag updates before backup or prune', async () => {
  const trigger = makeTrigger();
  await expect(
    trigger.runPreRuntimeUpdateLifecycle(
      {},
      makeContainer({ updateKind: { kind: 'digest' } }),
      trigger.log,
    ),
  ).rejects.toThrow('Portainer provider only supports tag updates');
});

test('Portainer delegates tag lifecycle calls to the inherited implementation', async () => {
  const trigger = makeTrigger();
  const inherited = vi
    .spyOn(DockerBase.prototype, 'runContainerUpdateLifecycle')
    .mockResolvedValue('updated' as never);
  await expect(trigger.runContainerUpdateLifecycle(makeContainer())).resolves.toBe('updated');
  expect(inherited).toHaveBeenCalledOnce();
  inherited.mockRestore();
});

test('redeployPortainerStack validates endpoint and honors dry-run', async () => {
  const trigger = makeTrigger();
  await expect(trigger.redeployPortainerStack({ Id: 12 }, 'services: {}', [])).rejects.toThrow(
    'has no EndpointId',
  );
  trigger.configuration.dryrun = true;
  await expect(
    trigger.redeployPortainerStack({ Id: 12, EndpointId: 1 }, 'services: {}', []),
  ).resolves.toBeUndefined();
});

test('performContainerUpdate pulls and runs the post-pull hook before a dry-run skip', async () => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  trigger.configuration.dryrun = true;
  const order: string[] = [];
  const inspect = vi.fn().mockResolvedValue({ Id: 'sha256:new' });
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue({
    mode: 'compose',
    stack: { Id: 12, Name: 'pihole', EndpointId: 1 },
    stackFileContent: 'services: {}',
    service: 'pihole',
    originalImage: 'pihole/pihole:2026.05.0',
    targetImage: 'pihole/pihole:2026.07.2',
    updatedStackFileContent: 'services: {}',
    updatedEnv: [],
  });
  vi.spyOn(trigger, 'pullImage').mockImplementation(async () => {
    order.push('pull');
  });
  const dockerApi = { getImage: vi.fn().mockReturnValue({ inspect }) };
  const redeploy = vi.spyOn(trigger, 'redeployPortainerStack').mockImplementation(async () => {
    order.push('put');
  });
  const wait = vi.spyOn(trigger, 'waitForPortainerRedeploy');
  const hook = vi.fn().mockImplementation(async () => {
    order.push('hook');
  });
  const result = await trigger.performContainerUpdate(
    { dockerApi, auth: undefined, newImage: 'pihole/pihole:2026.07.2' },
    makeContainer(),
    trigger.log,
    undefined,
    hook,
  );
  expect(result).toBe(false);
  expect(order).toEqual(['pull', 'hook']);
  expect(inspect).toHaveBeenCalledTimes(2);
  expect(redeploy).not.toHaveBeenCalled();
  expect(wait).not.toHaveBeenCalled();
});

test('getRollbackConfig preserves settings while disabling auto rollback', () => {
  const trigger = makeTrigger();
  const result = trigger.getRollbackConfig({
    labels: { 'dd.rollback.auto': 'true', 'dd.rollback.window': '1234' },
  });
  expect(result).toEqual({ autoRollback: false, rollbackWindow: 1234, rollbackInterval: 10000 });
});

test('getUpdateLockKeys includes normalized Portainer stack scope', () => {
  const trigger = makeTrigger();
  const keys = trigger.getUpdateLockKeys(
    makeContainer({
      labels: {
        'com.docker.compose.project': 'pihole',
        'com.docker.compose.service': 'pihole',
        'dd.portainer.endpoint-id': '1',
        'dd.portainer.stack-id': '12',
      },
    }),
  );
  expect(keys).toContain('portainer:http://portainer.lan:stack:12:endpoint:1');
});

test('getUpdateLockKeys falls back to project and unknown endpoint scope', () => {
  const trigger = makeTrigger();
  const keys = trigger.getUpdateLockKeys(
    makeContainer({ labels: { 'com.docker.compose.service': 'pihole' } }),
  );
  expect(keys).toContain(
    'portainer:http://portainer.lan:project:unknown:endpoint:unknown-endpoint',
  );
});

function makeResolvedUpdate() {
  return {
    mode: 'compose' as const,
    stack: { Id: 12, Name: 'pihole', EndpointId: 1 },
    stackFileContent: 'services: {}',
    service: 'pihole',
    originalImage: 'pihole/pihole:2026.05.0',
    targetImage: 'pihole/pihole:2026.07.2',
    updatedStackFileContent: 'services: {}',
    updatedEnv: [],
  };
}

test('performContainerUpdate captures running replicas before PUT and verifies the redeploy', async () => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  const resolved = makeResolvedUpdate();
  resolved.stack.Name = undefined;
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  const dockerApi = {
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
    }),
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        ImageID: 'sha256:old',
        Image: 'pihole/pihole:2026.05.0',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  const redeploy = vi.spyOn(trigger, 'redeployPortainerStack').mockResolvedValue(undefined);
  const wait = vi.spyOn(trigger, 'waitForPortainerRedeploy').mockResolvedValue(undefined);
  const result = await trigger.performContainerUpdate(
    { dockerApi, auth: undefined, newImage: 'pihole/pihole:2026.07.2' },
    makeContainer(),
    trigger.log,
  );
  expect(result).toBe(true);
  expect(resolved.prePutRunningReplicas).toBe(1);
  expect(redeploy).toHaveBeenCalledOnce();
  expect(wait).toHaveBeenCalledOnce();
});

test('performContainerUpdate captures the local image identity for convergence', async () => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  const dockerApi = {
    getImage: vi.fn().mockReturnValue({ inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }) }),
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        ImageID: 'sha256:old',
        Image: 'pihole/pihole:2026.05.0',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  vi.spyOn(trigger, 'redeployPortainerStack').mockResolvedValue(undefined);
  const wait = vi.spyOn(trigger, 'waitForPortainerRedeploy').mockResolvedValue(undefined);
  const hook = vi.fn();
  await trigger.performContainerUpdate(
    { dockerApi, auth: undefined, newImage: resolved.targetImage },
    makeContainer(),
    trigger.log,
    undefined,
    hook,
  );
  expect(resolved.targetImageId).toBe('sha256:new');
  expect(dockerApi.getImage).toHaveBeenCalledTimes(2);
  expect(hook).toHaveBeenCalledOnce();
  expect(wait).toHaveBeenCalledWith(
    dockerApi,
    expect.anything(),
    expect.objectContaining({
      targetImageId: 'sha256:new',
    }),
    trigger.log,
  );
});

test.each([
  ['mixed image IDs', ['sha256:old', 'sha256:other']],
  ['missing image ID', ['sha256:old', undefined]],
])('performContainerUpdate rejects baselines with %s', async (_label, imageIds) => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  const dockerApi = {
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
    }),
    listContainers: vi.fn().mockResolvedValue(
      imageIds.map((ImageID) => ({
        State: 'running',
        ImageID,
        Image: 'pihole/pihole:2026.05.0',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      })),
    ),
  };
  const redeploy = vi.spyOn(trigger, 'redeployPortainerStack').mockResolvedValue(undefined);
  await expect(
    trigger.performContainerUpdate(
      { dockerApi, newImage: resolved.targetImage },
      makeContainer(),
      trigger.log,
    ),
  ).rejects.toThrow('one original image identity');
  expect(redeploy).not.toHaveBeenCalled();
});

test('waitForPortainerRedeploy canonicalizes Docker Hub aliases and tags', async () => {
  const trigger = makeTrigger();
  const dockerApi = {
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        ImageID: 'sha256:target',
        Image: 'registry-1.docker.io/library/nginx:1',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  await expect(
    trigger.waitForPortainerRedeploy(
      dockerApi,
      makeContainer(),
      {
        ...makeResolvedUpdate(),
        targetImage: 'docker.io/library/nginx:1',
        targetImageId: 'sha256:target',
      },
      trigger.log,
    ),
  ).resolves.toBeUndefined();
});

test('performContainerUpdate waits for original convergence after an uncertain restore PUT', async () => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  const dockerApi = {
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
    }),
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        ImageID: 'sha256:old',
        Image: resolved.originalImage,
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  const primary = new Error('target convergence failed');
  const redeploy = vi
    .spyOn(trigger, 'redeployPortainerStack')
    .mockRejectedValueOnce(new Error('target PUT uncertain'))
    .mockRejectedValueOnce(new Error('restore PUT uncertain'));
  const wait = vi
    .spyOn(trigger, 'waitForPortainerRedeploy')
    .mockRejectedValueOnce(primary)
    .mockResolvedValueOnce(undefined);
  await expect(
    trigger.performContainerUpdate(
      { dockerApi, newImage: resolved.targetImage },
      makeContainer(),
      trigger.log,
    ),
  ).rejects.toThrow('target PUT uncertain (Portainer restore failed: restore PUT uncertain)');
  expect(redeploy).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledOnce();
});

test('performContainerUpdate aborts before Portainer PUT when the pulled image changes during the hook', async () => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  const inspect = vi
    .fn()
    .mockResolvedValueOnce({ Id: 'sha256:approved' })
    .mockResolvedValueOnce({ Id: 'sha256:changed' });
  const dockerApi = {
    getImage: vi.fn().mockReturnValue({ inspect }),
    listContainers: vi.fn(),
  };
  const redeploy = vi.spyOn(trigger, 'redeployPortainerStack').mockResolvedValue(undefined);
  await expect(
    trigger.performContainerUpdate(
      { dockerApi, newImage: resolved.targetImage },
      makeContainer(),
      trigger.log,
      undefined,
      vi.fn().mockResolvedValue(undefined),
    ),
  ).rejects.toThrow('changed during the post-pull hook');
  expect(redeploy).not.toHaveBeenCalled();
  expect(dockerApi.listContainers).not.toHaveBeenCalled();
});

test('performContainerUpdate waits for target convergence after an uncertain PUT before restoring', async () => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  const dockerApi = {
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
    }),
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        ImageID: 'sha256:old',
        Image: 'pihole/pihole:2026.05.0',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  const redeploy = vi
    .spyOn(trigger, 'redeployPortainerStack')
    .mockRejectedValueOnce(new Error('timeout'));
  const wait = vi.spyOn(trigger, 'waitForPortainerRedeploy').mockResolvedValueOnce(undefined);
  await expect(
    trigger.performContainerUpdate(
      { dockerApi, newImage: resolved.targetImage },
      makeContainer(),
      trigger.log,
    ),
  ).resolves.toBe(true);
  expect(wait).toHaveBeenCalledOnce();
  expect(redeploy).toHaveBeenCalledOnce();
});

test('preview handles absent and errored base previews and enriches a valid preview', async () => {
  const trigger = makeTrigger();
  const basePreview = vi.spyOn(DockerBase.prototype, 'preview');
  basePreview.mockResolvedValueOnce(undefined);
  await expect(trigger.preview(makeContainer())).resolves.toBeUndefined();
  basePreview.mockResolvedValueOnce({ error: 'not eligible' });
  await expect(trigger.preview(makeContainer())).resolves.toEqual({ error: 'not eligible' });
  basePreview.mockResolvedValueOnce({ newImage: 'pihole/pihole:2026.07.2' });
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(makeResolvedUpdate());
  await expect(trigger.preview(makeContainer())).resolves.toMatchObject({
    portainer: { stackId: 12, service: 'pihole', mode: 'compose' },
  });
  basePreview.mockResolvedValueOnce({ newImage: 'pihole/pihole:2026.07.2' });
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue({
    ...makeResolvedUpdate(),
    mode: 'env',
    versionVar: 'PIHOLE_TAG',
  });
  await expect(trigger.preview(makeContainer())).resolves.toMatchObject({
    portainer: { mutation: { intent: 'update-portainer-stack-env' } },
  });
  basePreview.mockRestore();
});

test('runPreRuntimeUpdateLifecycle skips dry-run preparation and delegates otherwise', async () => {
  const trigger = makeTrigger();
  const baseLifecycle = vi.spyOn(DockerBase.prototype, 'runPreRuntimeUpdateLifecycle');
  trigger.configuration.dryrun = true;
  await expect(
    trigger.runPreRuntimeUpdateLifecycle({}, makeContainer(), trigger.log),
  ).resolves.toBeUndefined();
  expect(baseLifecycle).not.toHaveBeenCalled();
  trigger.configuration.dryrun = false;
  baseLifecycle.mockResolvedValueOnce(undefined);
  await trigger.runPreRuntimeUpdateLifecycle({}, makeContainer(), trigger.log, {
    operationId: '1',
  });
  expect(baseLifecycle).toHaveBeenCalledOnce();
  baseLifecycle.mockRestore();
});

test('performContainerUpdate restores the original stack after a failed redeploy wait', async () => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  const dockerApi = {
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
    }),
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        ImageID: 'sha256:old',
        Image: resolved.originalImage,
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  const redeploy = vi.spyOn(trigger, 'redeployPortainerStack').mockResolvedValue(undefined);
  const primary = new Error('target convergence failed');
  const restore = 'restore convergence failed';
  vi.spyOn(trigger, 'waitForPortainerRedeploy')
    .mockRejectedValueOnce(primary)
    .mockRejectedValueOnce(restore);
  await expect(
    trigger.performContainerUpdate(
      { dockerApi, auth: undefined, newImage: resolved.targetImage },
      makeContainer(),
      trigger.log,
    ),
  ).rejects.toThrow(
    'target convergence failed (Portainer restore failed: restore convergence failed)',
  );
  expect(redeploy).toHaveBeenCalledTimes(2);
  expect(redeploy.mock.calls[1][1]).toBe(resolved.stackFileContent);
  expect(redeploy.mock.calls[1][2]).toEqual([]);
});

test('performContainerUpdate rejects digest updates and unavailable or stopped Docker replicas', async () => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  const digest = makeContainer({ updateKind: { kind: 'digest' } });
  await expect(
    trigger.performContainerUpdate(
      { dockerApi: {}, newImage: 'pihole/pihole@sha256:new' },
      digest,
      trigger.log,
    ),
  ).rejects.toThrow('only supports tag updates');
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  await expect(
    trigger.performContainerUpdate(
      {
        dockerApi: {
          getImage: vi.fn().mockReturnValue({
            inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
          }),
        },
        newImage: resolved.targetImage,
      },
      makeContainer(),
      trigger.log,
    ),
  ).rejects.toThrow('Docker listContainers is unavailable');
  await expect(
    trigger.performContainerUpdate(
      {
        dockerApi: {
          getImage: vi.fn().mockReturnValue({
            inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
          }),
          listContainers: vi.fn().mockResolvedValue([{ State: 'exited', Labels: {} }]),
        },
        newImage: resolved.targetImage,
      },
      makeContainer(),
      trigger.log,
    ),
  ).rejects.toThrow('no running replicas');
});

test('performContainerUpdate preserves the primary wait error when restoration succeeds', async () => {
  const trigger = makeTrigger({ skipEndpointVerification: true });
  const resolved = makeResolvedUpdate();
  vi.spyOn(trigger, 'resolvePortainerUpdate').mockResolvedValue(resolved);
  vi.spyOn(trigger, 'pullImage').mockResolvedValue(undefined);
  const dockerApi = {
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: 'sha256:new' }),
    }),
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        ImageID: 'sha256:old',
        Image: 'pihole/pihole:2026.05.0',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  vi.spyOn(trigger, 'redeployPortainerStack').mockResolvedValue(undefined);
  vi.spyOn(trigger, 'waitForPortainerRedeploy')
    .mockRejectedValueOnce(new Error('primary wait error'))
    .mockResolvedValueOnce(undefined);
  await expect(
    trigger.performContainerUpdate(
      { dockerApi, newImage: resolved.targetImage },
      makeContainer(),
      trigger.log,
    ),
  ).rejects.toThrow('primary wait error');
});

test('waitForPortainerRedeploy ignores exited historical replicas', async () => {
  const trigger = makeTrigger();
  const dockerApi = {
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        ImageID: 'sha256:target',
        Image: 'pihole/pihole:2026.07.2',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
      {
        State: 'exited',
        ImageID: 'sha256:old',
        Image: 'pihole/pihole:2026.05.0',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  await expect(
    trigger.waitForPortainerRedeploy(
      dockerApi,
      makeContainer(),
      { ...makeResolvedUpdate(), targetImageId: 'sha256:target', prePutRunningReplicas: 1 },
      trigger.log,
    ),
  ).resolves.toBeUndefined();
});

test('waitForPortainerRedeploy uses safe service fallback names and times out without an image', async () => {
  vi.useFakeTimers();
  const trigger = makeTrigger();
  trigger.configuration.redeployTimeout = 1;
  const dockerApi = {
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'exited',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  const waitPromise = expect(
    trigger.waitForPortainerRedeploy(
      dockerApi,
      makeContainer(),
      { ...makeResolvedUpdate(), stack: { Id: 12 }, prePutRunningReplicas: 1 },
      trigger.log,
    ),
  ).rejects.toThrow('Timed out waiting for Portainer stack 12 service pihole');
  await vi.advanceTimersByTimeAsync(2000);
  await waitPromise;
  vi.useRealTimers();
});

test('waitForPortainerRedeploy identifies a target without a name or id', async () => {
  const trigger = makeTrigger();
  const dockerApi = {
    listContainers: vi.fn().mockResolvedValue([
      {
        State: 'running',
        ImageID: 'sha256:target',
        Image: 'pihole/pihole:2026.07.2',
        Labels: {
          'com.docker.compose.project': 'pihole',
          'com.docker.compose.service': 'pihole',
        },
      },
    ]),
  };
  await expect(
    trigger.waitForPortainerRedeploy(
      dockerApi,
      makeContainer(),
      { ...makeResolvedUpdate(), targetImageId: 'sha256:target' },
      trigger.log,
    ),
  ).resolves.toBeUndefined();
});

test('waitForPortainerRedeploy fails when Docker verification is unavailable', async () => {
  const trigger = makeTrigger();
  await expect(
    trigger.waitForPortainerRedeploy(undefined, makeContainer(), makeResolvedUpdate(), trigger.log),
  ).rejects.toThrow('Docker listContainers is unavailable');
});

test('verifyPortainerEndpoint fails closed when identity inputs are invalid', async () => {
  const trigger = makeTrigger();
  const container = makeContainer();
  await expect(trigger.verifyPortainerEndpoint(undefined, container, undefined)).rejects.toThrow(
    'valid endpoint',
  );
  await expect(trigger.verifyPortainerEndpoint(1, container, {})).rejects.toThrow(
    'data is unavailable',
  );
  await expect(
    trigger.verifyPortainerEndpoint(
      1,
      { id: undefined },
      {
        Id: 'container-id',
        Image: 'sha256:old',
        Config: { Image: 'pihole/pihole:2026.05.0' },
        State: { Running: true, Status: 'running' },
      },
    ),
  ).rejects.toThrow('data is unavailable');
  await expect(
    trigger.verifyPortainerEndpoint(1, container, {
      Id: 'different-container',
      Image: 'sha256:old',
      Config: { Image: 'pihole/pihole:2026.05.0' },
      State: { Running: true, Status: 'running' },
    }),
  ).rejects.toThrow('watched Docker container');
});
