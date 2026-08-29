import Portainer, {
  testable_extractTagVariable,
  testable_getComposeProjectPaths,
  testable_upsertStackEnv,
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

function makeTrigger() {
  const trigger = new Portainer();
  trigger.configuration = {
    url: 'http://portainer.lan',
    apikey: 'secret',
    updateMode: 'auto',
    versionVarLabel: 'dd.portainer.version-var',
    updateModeLabel: 'dd.portainer.update-mode',
    pullImage: true,
    pruneStack: false,
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
  return trigger;
}

function makeContainer(overrides: Record<string, unknown> = {}) {
  return {
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
});

test('getComposeProjectPaths resolves relative compose config files from working dir', () => {
  expect([
    ...testable_getComposeProjectPaths({
      'com.docker.compose.project.working_dir': '/data/compose/12',
      'com.docker.compose.project.config_files': 'docker-compose.yml,override.yml',
    }),
  ]).toEqual(['/data/compose/12']);
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
    ['services:', '  pihole:', '    image: pihole/pihole:${PIHOLE_TAG:-2026.05.0}', ''].join('\n'),
  );

  const update = await trigger.resolvePortainerUpdate(makeContainer(), 'pihole/pihole:2026.07.2');

  expect(update.mode).toBe('env');
  expect(update.versionVar).toBe('PIHOLE_TAG');
  expect(update.updatedStackFileContent).toContain('${PIHOLE_TAG:-2026.05.0}');
  expect(update.updatedEnv).toEqual([{ name: 'PIHOLE_TAG', value: '2026.07.2' }]);
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
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'secret',
    },
    body: JSON.stringify({
      stackFileContent: 'services: {}',
      env: [{ name: 'PIHOLE_TAG', value: '2026.07.2' }],
      prune: false,
      pullImage: true,
    }),
  });

  vi.unstubAllGlobals();
});
