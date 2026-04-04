import { beforeEach, describe, expect, test, vi } from 'vitest';

type ComponentLike = {
  name?: string;
  type?: string;
};

type DiscoveryTopicArgs = {
  kind: string;
  topic: string;
};

const BASE_TIME = new Date('2026-03-18T12:00:00.000Z');
const VERSION = '1.2.3';

const {
  mockMapComponentsToList,
  mockGetVersion,
  mockDdEnvVars,
  mockGetState,
  mockGetContainersRaw,
  mockGetDebugSnapshot,
  mockRedactDebugDump,
} = vi.hoisted(() => {
  const mockMapComponentsToList = vi.fn(
    (components: Record<string, ComponentLike>, kind?: string) =>
      Object.keys(components)
        .sort()
        .map((id) => ({
          id,
          kind: kind ?? 'unknown',
          name: components[id]?.name ?? id,
        })),
  );

  return {
    mockMapComponentsToList,
    mockGetVersion: vi.fn(),
    mockDdEnvVars: {} as Record<string, string | undefined>,
    mockGetState: vi.fn(),
    mockGetContainersRaw: vi.fn(),
    mockGetDebugSnapshot: vi.fn(),
    mockRedactDebugDump: vi.fn((payload: unknown) => payload),
  };
});

vi.mock('../api/component.js', () => ({
  mapComponentsToList: mockMapComponentsToList,
}));

vi.mock('../configuration/index.js', () => ({
  ddEnvVars: mockDdEnvVars,
  getVersion: mockGetVersion,
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../store/container.js', () => ({
  getContainersRaw: mockGetContainersRaw,
}));

vi.mock('../store/index.js', () => ({
  getDebugSnapshot: mockGetDebugSnapshot,
}));

vi.mock('./redact.js', () => ({
  redactDebugDump: mockRedactDebugDump,
}));

import {
  collectDebugDump,
  DEFAULT_RECENT_EVENT_MINUTES,
  getDebugDumpFilename,
  MAX_RECENT_EVENT_MINUTES,
  MIN_RECENT_EVENT_MINUTES,
  serializeDebugDump,
} from './dump.js';

function component(name: string, type: string): ComponentLike {
  return { name, type };
}

function minutesAgoIso(minutes: number) {
  return new Date(BASE_TIME.getTime() - minutes * 60_000).toISOString();
}

function createSensor(discoveryTopic: string, stateTopic: string) {
  return {
    discoveryTopic,
    stateTopic,
    unique_id: stateTopic.replaceAll('/', '_'),
  };
}

function buildMqttSensors(
  discoveryTopicFactory: (kind: string, topic: string) => string,
  topicBase: string,
  includeTrackedUpdates = true,
) {
  const sensors = [
    ['sensor', `${topicBase}/total_count`],
    ['sensor', `${topicBase}/update_count`],
    ['binary_sensor', `${topicBase}/update_status`],
    ['sensor', `${topicBase}/alpha/total_count`],
    ['sensor', `${topicBase}/alpha/update_count`],
    ['binary_sensor', `${topicBase}/alpha/update_status`],
    ['binary_sensor', `${topicBase}/alpha/running`],
    ['sensor', `${topicBase}/beta/total_count`],
    ['sensor', `${topicBase}/beta/update_count`],
    ['binary_sensor', `${topicBase}/beta/update_status`],
    ['binary_sensor', `${topicBase}/beta/running`],
    ['sensor', `${topicBase}/delta/total_count`],
    ['sensor', `${topicBase}/delta/update_count`],
    ['binary_sensor', `${topicBase}/delta/update_status`],
    ['binary_sensor', `${topicBase}/delta/running`],
  ];

  if (includeTrackedUpdates) {
    sensors.push(['update', `${topicBase}/alpha-1`], ['update', `${topicBase}/beta-1`]);
  }

  return sensors.map(([kind, topic]) => createSensor(discoveryTopicFactory(kind, topic), topic));
}

function createFixture() {
  const alphaEnsureRemoteAuthHeaders = vi.fn().mockResolvedValue(undefined);
  const alphaVersion = vi.fn().mockResolvedValue({ version: '25.0.0' });
  const alphaInfo = vi.fn().mockResolvedValue({ ServerVersion: '25.0.0' });
  const alphaEvents = vi.fn().mockReturnValue([
    { timestamp: '2026-03-18T11:50:00.000Z', action: 'start', id: 'alpha-event-1' },
    { timestamp: '2026-03-18T11:51:00.000Z', action: 'stop', id: 'alpha-event-2' },
  ]);
  const alphaDecisions = vi.fn().mockReturnValue([
    {
      timestamp: '2026-03-18T11:52:00.000Z',
      containerId: 'alpha-container-1',
      containerName: 'alpha-one',
      decision: 'allowed',
      reason: 'alias-allowed-no-collision',
      baseName: 'alpha',
    },
  ]);

  const betaEnsureRemoteAuthHeaders = vi.fn().mockRejectedValue(new Error('beta auth failed'));
  const betaVersion = vi.fn().mockRejectedValue('beta version failed');
  const betaInfo = vi.fn().mockRejectedValue({ reason: 'beta info failed' });
  const betaEvents = vi
    .fn()
    .mockReturnValue([
      null,
      { timestamp: '2026-03-18T11:53:00.000Z', action: 'pull', id: 'beta-event-1' },
    ]);
  const betaDecisions = vi.fn().mockReturnValue([
    null,
    {
      timestamp: '2026-03-18T11:54:00.000Z',
      containerId: 'beta-container-1',
      containerName: 'beta-one',
      decision: 'skipped',
      reason: 'base-name-present-in-docker',
      baseName: 'beta',
    },
  ]);

  const deltaEnsureRemoteAuthHeaders = vi.fn().mockRejectedValue('delta auth failed');
  const deltaVersion = vi.fn().mockRejectedValue(new Error('delta version failed'));
  const deltaInfo = vi.fn().mockRejectedValue(new Error('delta info failed'));
  const deltaEvents = vi
    .fn()
    .mockReturnValue([
      { timestamp: '2026-03-18T11:55:00.000Z', action: 'die', id: 'delta-event-1' },
    ]);
  const deltaDecisions = vi.fn().mockReturnValue([
    {
      timestamp: '2026-03-18T11:56:00.000Z',
      containerId: 'delta-container-1',
      containerName: 'delta-one',
      decision: 'allowed',
      reason: 'fresh-recreated-alias',
      baseName: 'delta',
    },
  ]);

  const sharedDiscoveryTopic = vi.fn(
    ({ kind, topic }: DiscoveryTopicArgs) => `disc:${kind}:${topic}`,
  );
  const emptyDiscoveryTopic = vi.fn(
    ({ kind, topic }: DiscoveryTopicArgs) => `disc-empty:${kind}:${topic}`,
  );
  const httpDiscoveryTopic = vi.fn(
    ({ kind, topic }: DiscoveryTopicArgs) => `disc-http:${kind}:${topic}`,
  );
  const skipDiscoveryTopic = vi.fn(() => '');

  const state = {
    watcher: {
      'docker.alpha': {
        type: 'docker',
        name: 'alpha',
        configuration: { watchevents: true },
        isDockerEventsListenerActive: true,
        dockerEventsStream: {},
        dockerEventsReconnectTimeout: {},
        dockerEventsReconnectAttempt: 2,
        dockerEventsReconnectDelayMs: 1500,
        ensureRemoteAuthHeaders: alphaEnsureRemoteAuthHeaders,
        dockerApi: {
          version: alphaVersion,
          info: alphaInfo,
        },
        getRecentDockerEvents: alphaEvents,
        getRecentAliasFilterDecisions: alphaDecisions,
      },
      'docker.beta': {
        type: 'docker',
        name: 'beta',
        configuration: { watchevents: false },
        isDockerEventsListenerActive: false,
        ensureRemoteAuthHeaders: betaEnsureRemoteAuthHeaders,
        dockerApi: {
          version: betaVersion,
          info: betaInfo,
        },
        getRecentDockerEvents: betaEvents,
        getRecentAliasFilterDecisions: betaDecisions,
      },
      'docker.delta': {
        type: 'docker',
        name: 'delta',
        configuration: { watchevents: true },
        isDockerEventsListenerActive: false,
        dockerEventsReconnectAttempt: 0,
        dockerEventsReconnectDelayMs: 0,
        ensureRemoteAuthHeaders: deltaEnsureRemoteAuthHeaders,
        dockerApi: {
          version: deltaVersion,
          info: deltaInfo,
        },
        getRecentDockerEvents: deltaEvents,
        getRecentAliasFilterDecisions: deltaDecisions,
      },
      'docker.epsilon': {
        type: 'docker',
        name: 'epsilon',
        isDockerEventsListenerActive: false,
      },
      'docker.gamma': {
        type: 'docker',
        name: 'gamma',
        configuration: {},
        isDockerEventsListenerActive: false,
      },
      'compose.ignored': {
        type: 'compose',
        name: 'ignored',
      },
    },
    trigger: {
      'mqtt.main': {
        type: 'mqtt',
        name: 'main',
        configuration: { topic: 'custom/base' },
        hass: {
          getDiscoveryTopic: sharedDiscoveryTopic,
          containerStateTopicById: new Map([
            ['container-a', 'custom/base/alpha-1'],
            ['container-b', 'custom/base/alpha-1'],
            ['container-c', 'custom/base/beta-1'],
          ]),
        },
      },
      'mqtt.dup': {
        type: 'mqtt',
        name: 'dup',
        configuration: { topic: 'custom/base' },
        hass: {
          getDiscoveryTopic: sharedDiscoveryTopic,
          containerStateTopicById: new Map([
            ['container-a', 'custom/base/alpha-1'],
            ['container-b', 'custom/base/alpha-1'],
            ['container-c', 'custom/base/beta-1'],
          ]),
        },
      },
      'mqtt.default': {
        type: 'mqtt',
        name: 'default',
        hass: {
          getDiscoveryTopic: sharedDiscoveryTopic,
        },
      },
      'mqtt.empty': {
        type: 'mqtt',
        name: 'empty',
        configuration: { topic: '' },
        hass: {
          getDiscoveryTopic: emptyDiscoveryTopic,
        },
      },
      'mqtt.skip': {
        type: 'mqtt',
        name: 'skip',
        configuration: { topic: 'skip/base' },
        hass: {
          getDiscoveryTopic: skipDiscoveryTopic,
        },
      },
      'http.with-hass': {
        type: 'http',
        name: 'with-hass',
        hass: {
          getDiscoveryTopic: httpDiscoveryTopic,
        },
      },
      'mqtt.none': {
        type: 'mqtt',
        name: 'none',
        hass: {},
      },
      'mqtt.nohass': {
        type: 'mqtt',
        name: 'nohass',
      },
      'http.other': {
        type: 'http',
        name: 'other',
      },
    },
    registry: {
      'registry.alpha': component('alpha', 'registry'),
      'registry.beta': component('beta', 'registry'),
    },
    authentication: {
      'auth.main': component('main', 'authentication'),
    },
    agent: {
      'agent.remote': component('remote', 'agent'),
    },
  };

  const containers = [
    { id: 'c1', name: 'alpha-one', watcher: 'alpha' },
    { id: 'c2', name: 'alpha-two', watcher: 'alpha' },
    { id: 'c3', name: 'beta-one', watcher: 'beta' },
    { id: 'c4', name: 'delta-one', watcher: 'delta' },
    { id: 'c5', name: 'orphan' },
    { id: 'c6', name: 'alpha-one-copy', watcher: 'alpha' },
  ];

  const storeSnapshot = {
    memoryMode: false,
    path: '/var/lib/drydock/dd.json',
    collectionCount: 2,
    documentCount: 7,
    lastPersistAt: '2026-03-18T11:59:30.000Z',
    collections: [
      { name: 'containers', documents: 4 },
      { name: 'settings', documents: 3 },
    ],
  };

  return {
    state,
    containers,
    storeSnapshot,
    alphaEnsureRemoteAuthHeaders,
    alphaVersion,
    alphaInfo,
    alphaEvents,
    alphaDecisions,
    betaEnsureRemoteAuthHeaders,
    betaVersion,
    betaInfo,
    betaEvents,
    betaDecisions,
    deltaEnsureRemoteAuthHeaders,
    deltaVersion,
    deltaInfo,
    deltaEvents,
    deltaDecisions,
    sharedDiscoveryTopic,
    skipDiscoveryTopic,
  };
}

function configureFixture() {
  const fixture = createFixture();

  mockGetState.mockReturnValue(fixture.state);
  mockGetContainersRaw.mockReturnValue(fixture.containers);
  mockGetDebugSnapshot.mockReturnValue(fixture.storeSnapshot);
  mockGetVersion.mockReturnValue(VERSION);

  for (const key of Object.keys(mockDdEnvVars)) {
    delete mockDdEnvVars[key];
  }
  mockDdEnvVars.DD_VERSION = VERSION;
  mockDdEnvVars.DD_DEBUG = 'true';
  mockDdEnvVars.DD_SECRET_TOKEN = 'should-be-redacted-by-real-code';

  return fixture;
}

describe('debug dump utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    vi.clearAllMocks();
    vi.spyOn(process, 'uptime').mockReturnValue(0.4);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test.each([
    { label: 'default', options: undefined, expectedMinutes: DEFAULT_RECENT_EVENT_MINUTES },
    {
      label: 'min clamp',
      options: { recentMinutes: 0 },
      expectedMinutes: MIN_RECENT_EVENT_MINUTES,
    },
    {
      label: 'max clamp',
      options: { recentMinutes: MAX_RECENT_EVENT_MINUTES + 1 },
      expectedMinutes: MAX_RECENT_EVENT_MINUTES,
    },
    { label: 'truncation', options: { recentMinutes: 12.9 }, expectedMinutes: 12 },
  ])('collectDebugDump normalizes recent minutes ($label)', async ({
    options,
    expectedMinutes,
  }) => {
    configureFixture();

    const dump = await collectDebugDump(options);

    expect(dump.metadata.recentMinutes).toBe(expectedMinutes);
    expect(dump.metadata.generatedAt).toBe(BASE_TIME.toISOString());
    expect(dump.metadata.generatedAtWindowStart).toBe(minutesAgoIso(expectedMinutes));
  });

  test('collectDebugDump composes debug data from watchers, triggers, store, and environment', async () => {
    const fixture = configureFixture();
    const sinceMs = Date.parse(minutesAgoIso(12));

    const dump = await collectDebugDump({ recentMinutes: 12.9 });

    expect(mockMapComponentsToList).toHaveBeenNthCalledWith(1, fixture.state.watcher, 'watcher');
    expect(mockMapComponentsToList).toHaveBeenNthCalledWith(2, fixture.state.trigger, 'trigger');
    expect(mockMapComponentsToList).toHaveBeenNthCalledWith(3, fixture.state.registry, 'registry');
    expect(mockMapComponentsToList).toHaveBeenNthCalledWith(
      4,
      fixture.state.authentication,
      'authentication',
    );
    expect(mockMapComponentsToList).toHaveBeenNthCalledWith(5, fixture.state.agent, 'agent');

    expect(dump.metadata).toEqual({
      generatedAt: BASE_TIME.toISOString(),
      generatedAtWindowStart: minutesAgoIso(12),
      recentMinutes: 12,
      drydockVersion: VERSION,
      nodeVersion: process.version,
      uptimeSeconds: 0,
    });

    expect(dump.state).toEqual({
      containers: fixture.containers,
      watchers: [
        { id: 'compose.ignored', kind: 'watcher', name: 'ignored' },
        { id: 'docker.alpha', kind: 'watcher', name: 'alpha' },
        { id: 'docker.beta', kind: 'watcher', name: 'beta' },
        { id: 'docker.delta', kind: 'watcher', name: 'delta' },
        { id: 'docker.epsilon', kind: 'watcher', name: 'epsilon' },
        { id: 'docker.gamma', kind: 'watcher', name: 'gamma' },
      ],
      triggers: [
        { id: 'http.other', kind: 'trigger', name: 'other' },
        { id: 'http.with-hass', kind: 'trigger', name: 'with-hass' },
        { id: 'mqtt.default', kind: 'trigger', name: 'default' },
        { id: 'mqtt.dup', kind: 'trigger', name: 'dup' },
        { id: 'mqtt.empty', kind: 'trigger', name: 'empty' },
        { id: 'mqtt.main', kind: 'trigger', name: 'main' },
        { id: 'mqtt.nohass', kind: 'trigger', name: 'nohass' },
        { id: 'mqtt.none', kind: 'trigger', name: 'none' },
        { id: 'mqtt.skip', kind: 'trigger', name: 'skip' },
      ],
      registries: [
        { id: 'registry.alpha', kind: 'registry', name: 'alpha' },
        { id: 'registry.beta', kind: 'registry', name: 'beta' },
      ],
      authentications: [{ id: 'auth.main', kind: 'authentication', name: 'main' }],
      agents: [{ id: 'agent.remote', kind: 'agent', name: 'remote' }],
    });

    const expectedSensors = [
      ...buildMqttSensors((kind, topic) => `disc:${kind}:${topic}`, 'custom/base'),
      ...buildMqttSensors((kind, topic) => `disc:${kind}:${topic}`, 'dd/container', false),
      ...buildMqttSensors((kind, topic) => `disc-empty:${kind}:${topic}`, 'dd/container', false),
    ].sort((left, right) => left.discoveryTopic.localeCompare(right.discoveryTopic));

    expect(dump.mqttHomeAssistant.sensors).toEqual(expectedSensors);

    expect(fixture.alphaEnsureRemoteAuthHeaders).toHaveBeenCalledTimes(1);
    expect(fixture.betaEnsureRemoteAuthHeaders).toHaveBeenCalledTimes(1);
    expect(fixture.deltaEnsureRemoteAuthHeaders).toHaveBeenCalledTimes(1);
    expect(fixture.alphaVersion).toHaveBeenCalledTimes(1);
    expect(fixture.betaVersion).toHaveBeenCalledTimes(1);
    expect(fixture.deltaVersion).toHaveBeenCalledTimes(1);
    expect(fixture.alphaInfo).toHaveBeenCalledTimes(1);
    expect(fixture.betaInfo).toHaveBeenCalledTimes(1);
    expect(fixture.deltaInfo).toHaveBeenCalledTimes(1);

    expect(dump.dockerApi.watchers).toEqual([
      {
        watcherId: 'docker.alpha',
        watcherName: 'alpha',
        version: { version: '25.0.0' },
        info: { ServerVersion: '25.0.0' },
      },
      {
        watcherId: 'docker.beta',
        watcherName: 'beta',
        authInitializationError: 'beta auth failed',
        versionError: 'beta version failed',
        infoError: '[object Object]',
      },
      {
        watcherId: 'docker.delta',
        watcherName: 'delta',
        authInitializationError: 'delta auth failed',
        versionError: 'delta version failed',
        infoError: 'delta info failed',
      },
      {
        watcherId: 'docker.epsilon',
        watcherName: 'epsilon',
      },
      {
        watcherId: 'docker.gamma',
        watcherName: 'gamma',
      },
    ]);

    expect(dump.dockerEvents.activeSubscriptions).toEqual([
      {
        watcherId: 'docker.alpha',
        watcherName: 'alpha',
        watchEventsEnabled: true,
        listenerActive: true,
        streamActive: true,
        reconnectScheduled: true,
        reconnectAttempt: 2,
        reconnectDelayMs: 1500,
      },
      {
        watcherId: 'docker.beta',
        watcherName: 'beta',
        watchEventsEnabled: false,
        listenerActive: false,
        streamActive: false,
        reconnectScheduled: false,
        reconnectAttempt: 0,
        reconnectDelayMs: 0,
      },
      {
        watcherId: 'docker.delta',
        watcherName: 'delta',
        watchEventsEnabled: true,
        listenerActive: false,
        streamActive: false,
        reconnectScheduled: false,
        reconnectAttempt: 0,
        reconnectDelayMs: 0,
      },
      {
        watcherId: 'docker.epsilon',
        watcherName: 'epsilon',
        watchEventsEnabled: false,
        listenerActive: false,
        streamActive: false,
        reconnectScheduled: false,
        reconnectAttempt: 0,
        reconnectDelayMs: 0,
      },
      {
        watcherId: 'docker.gamma',
        watcherName: 'gamma',
        watchEventsEnabled: false,
        listenerActive: false,
        streamActive: false,
        reconnectScheduled: false,
        reconnectAttempt: 0,
        reconnectDelayMs: 0,
      },
    ]);

    expect(fixture.alphaEvents).toHaveBeenCalledWith({ sinceMs });
    expect(fixture.betaEvents).toHaveBeenCalledWith({ sinceMs });
    expect(fixture.deltaEvents).toHaveBeenCalledWith({ sinceMs });
    expect(fixture.alphaDecisions).toHaveBeenCalledWith({ sinceMs });
    expect(fixture.betaDecisions).toHaveBeenCalledWith({ sinceMs });
    expect(fixture.deltaDecisions).toHaveBeenCalledWith({ sinceMs });

    expect(dump.dockerEvents.recentEvents).toEqual([
      {
        watcherId: 'docker.alpha',
        watcherName: 'alpha',
        timestamp: '2026-03-18T11:50:00.000Z',
        action: 'start',
        id: 'alpha-event-1',
      },
      {
        watcherId: 'docker.alpha',
        watcherName: 'alpha',
        timestamp: '2026-03-18T11:51:00.000Z',
        action: 'stop',
        id: 'alpha-event-2',
      },
      {
        watcherId: 'docker.beta',
        watcherName: 'beta',
      },
      {
        watcherId: 'docker.beta',
        watcherName: 'beta',
        timestamp: '2026-03-18T11:53:00.000Z',
        action: 'pull',
        id: 'beta-event-1',
      },
      {
        watcherId: 'docker.delta',
        watcherName: 'delta',
        timestamp: '2026-03-18T11:55:00.000Z',
        action: 'die',
        id: 'delta-event-1',
      },
    ]);

    expect(dump.aliasFiltering.recentDecisions).toEqual([
      {
        watcherId: 'docker.alpha',
        watcherName: 'alpha',
        timestamp: '2026-03-18T11:52:00.000Z',
        containerId: 'alpha-container-1',
        containerName: 'alpha-one',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
        baseName: 'alpha',
      },
      {
        watcherId: 'docker.beta',
        watcherName: 'beta',
      },
      {
        watcherId: 'docker.beta',
        watcherName: 'beta',
        timestamp: '2026-03-18T11:54:00.000Z',
        containerId: 'beta-container-1',
        containerName: 'beta-one',
        decision: 'skipped',
        reason: 'base-name-present-in-docker',
        baseName: 'beta',
      },
      {
        watcherId: 'docker.delta',
        watcherName: 'delta',
        timestamp: '2026-03-18T11:56:00.000Z',
        containerId: 'delta-container-1',
        containerName: 'delta-one',
        decision: 'allowed',
        reason: 'fresh-recreated-alias',
        baseName: 'delta',
      },
    ]);

    expect(dump.store.stats).toEqual(fixture.storeSnapshot);
    expect(dump.environment).toEqual({
      ddEnvVars: {
        DD_VERSION: VERSION,
        DD_DEBUG: 'true',
        DD_SECRET_TOKEN: 'should-be-redacted-by-real-code',
      },
    });
    expect(mockRedactDebugDump).toHaveBeenCalledTimes(1);
  });

  test('serializeDebugDump appends a trailing newline', () => {
    expect(serializeDebugDump({ hello: 'world' })).toBe('{\n  "hello": "world"\n}\n');
  });

  test('getDebugDumpFilename formats the date safely for filenames', () => {
    expect(getDebugDumpFilename(new Date('2026-03-18T12:34:56.789Z'))).toBe(
      'drydock-debug-dump-2026-03-18.json',
    );
  });
});
