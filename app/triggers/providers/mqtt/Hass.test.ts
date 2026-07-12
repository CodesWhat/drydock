import {
  registerContainerAdded,
  registerContainerRemoved,
  registerContainerUpdated,
  registerWatcherStart,
  registerWatcherStop,
} from '../../../event/index.js';
import log from '../../../log/index.js';
import * as compatibility from '../../../prometheus/compatibility.js';
import * as containerStore from '../../../store/container.js';
import * as requestUpdateModule from '../../../updates/request-update.js';
import { UpdateRequestError } from '../../../updates/request-update.js';
import Hass, { HASS_CONTAINER_STATE_TOPIC_TRACK_LIMIT } from './Hass.js';
import { getHassCommandTopicFromStateTopic } from './hass-commands.js';

const MOCK_VERSION = '1.4.0-test';

vi.mock('../../../event/index.js', () => ({
  registerContainerAdded: vi.fn(),
  registerContainerUpdated: vi.fn(),
  registerContainerRemoved: vi.fn(),
  registerWatcherStart: vi.fn(),
  registerWatcherStop: vi.fn(),
}));

vi.mock('../../../configuration/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getVersion: () => MOCK_VERSION,
  };
});

// #210 — recordAuditEvent is fully mocked (not spied) since the real
// implementation writes to the LokiJS audit store, which is not wired up in
// this unit-test environment.
const { mockRecordAuditEvent } = vi.hoisted(() => ({
  mockRecordAuditEvent: vi.fn(),
}));

vi.mock('../../../api/audit-events.js', () => ({
  recordAuditEvent: mockRecordAuditEvent,
}));

// #210 — flush the microtask queue past a macrotask boundary, so every
// pending `.then()`/`await` chain triggered by an unawaited command-message
// listener invocation (see fireCommandMessage below) has settled, regardless
// of how many microtask hops it took.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// #210 — builds a fully hass-command-capable mqtt client double.
function makeCapableClientMock() {
  return {
    publish: vi.fn(() => {}),
    subscribeAsync: vi.fn().mockResolvedValue(undefined),
    unsubscribeAsync: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}

function getRegisteredMessageListener(clientMock: { on: ReturnType<typeof vi.fn> }) {
  const call = clientMock.on.mock.calls.find(([event]: [string]) => event === 'message');
  return call?.[1] as
    | ((topic: string, payload: Buffer, packet: { retain: boolean }) => void)
    | undefined;
}

async function fireCommandMessage(
  clientMock: { on: ReturnType<typeof vi.fn> },
  topic: string,
  payload: string | Buffer,
  packet: { retain: boolean } = { retain: false },
): Promise<void> {
  const listener = getRegisteredMessageListener(clientMock);
  listener?.(topic, Buffer.isBuffer(payload) ? payload : Buffer.from(payload), packet);
  await flushMicrotasks();
}

const containerData = [
  {
    containerName: 'container-name',
    data: {
      discoveryTopic: 'homeassistant/update/topic_watcher-name_container-name/config',
      unique_id: 'topic_watcher-name_container-name',
      default_entity_id: 'update.topic_watcher-name_container-name',
      name: 'topic_watcher-name_container-name',
      topic: 'topic/watcher-name/container-name',
    },
  },
  {
    containerName: 'container-1.name',
    data: {
      discoveryTopic: 'homeassistant/update/topic_watcher-name_container-1-name/config',
      unique_id: 'topic_watcher-name_container-1-name',
      default_entity_id: 'update.topic_watcher-name_container-1-name',
      name: 'topic_watcher-name_container-1-name',
      topic: 'topic/watcher-name/container-1-name',
    },
  },
];

let hass;
let mqttClientMock;

beforeEach(async () => {
  vi.resetAllMocks();
  mqttClientMock = {
    publish: vi.fn(() => {}),
  };
  hass = new Hass({
    client: mqttClientMock,
    configuration: {
      topic: 'topic',
      hass: {
        discovery: true,
        prefix: 'homeassistant',
      },
    },
    log,
    isContainerAllowed: () => true,
  });
});

test('publishDiscoveryMessage must publish a discovery message expected by HA', async () => {
  await hass.publishDiscoveryMessage({
    discoveryTopic: 'my/discovery',
    stateTopic: 'my/state',
    kind: 'sensor',
    name: 'My state',
    options: {
      myOption: true,
    },
  });
  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'my/discovery',
    JSON.stringify({
      unique_id: 'my_state',
      default_entity_id: 'sensor.my_state',
      name: 'My state',
      device: {
        identifiers: ['drydock'],
        manufacturer: 'drydock',
        model: 'drydock',
        name: 'drydock',
        sw_version: MOCK_VERSION,
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
      state_topic: 'my/state',
      myOption: true,
    }),
    { retain: true },
  );
});

test('removeSensor should publish an empty retained payload to remove discovery', async () => {
  await hass.removeSensor({
    discoveryTopic: 'my/discovery/topic',
  });

  expect(mqttClientMock.publish).toHaveBeenCalledWith('my/discovery/topic', '', {
    retain: true,
  });
});

test('addContainerSensor should remove stale discovery topic when the container name changes', async () => {
  const updateContainerSensorsSpy = vi
    .spyOn(hass, 'updateContainerSensors')
    .mockResolvedValue(undefined);

  await hass.addContainerSensor({
    id: 'container-id-123',
    name: 'old-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  mqttClientMock.publish.mockClear();

  await hass.addContainerSensor({
    id: 'container-id-123',
    name: 'new-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_old-name/config',
    '',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_new-name/config',
    expect.any(String),
    { retain: true },
  );

  updateContainerSensorsSpy.mockRestore();
});

test('addContainerSensor should canonicalize recreated alias-prefixed names to base topic', async () => {
  const updateContainerSensorsSpy = vi
    .spyOn(hass, 'updateContainerSensors')
    .mockResolvedValue(undefined);

  await hass.addContainerSensor({
    id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
    name: '7ea6b8a42686_termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_7ea6b8a42686_termix/config',
    '',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_termix/config',
    expect.stringContaining('"state_topic":"topic/watcher-name/termix"'),
    { retain: true },
  );

  updateContainerSensorsSpy.mockRestore();
});

test('addContainerSensor should remove legacy recreated-alias discovery topic for base names', async () => {
  const updateContainerSensorsSpy = vi
    .spyOn(hass, 'updateContainerSensors')
    .mockResolvedValue(undefined);

  await hass.addContainerSensor({
    id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
    name: 'termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_7ea6b8a42686_termix/config',
    '',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_termix/config',
    expect.stringContaining('"state_topic":"topic/watcher-name/termix"'),
    { retain: true },
  );

  updateContainerSensorsSpy.mockRestore();
});

test('addContainerSensor must publish sensor discovery message expected by HA', async () => {
  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });
  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_container-name/config',
    JSON.stringify({
      unique_id: 'topic_watcher-name_container-name',
      default_entity_id: 'update.topic_watcher-name_container-name',
      name: 'topic_watcher-name_container-name',
      device: {
        identifiers: ['drydock'],
        manufacturer: 'drydock',
        model: 'drydock',
        name: 'drydock',
        sw_version: MOCK_VERSION,
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
      state_topic: 'topic/watcher-name/container-name',
      force_update: true,
      value_template: '{{ value_json.image_tag_value }}',
      latest_version_topic: 'topic/watcher-name/container-name',
      latest_version_template:
        '{% if value_json.update_kind_kind == "digest" %}{{ value_json.result_digest[:15] if value_json.result_digest else value_json.image_tag_value }}{% else %}{{ value_json.result_tag if value_json.result_tag else value_json.image_tag_value }}{% endif %}',
      json_attributes_topic: 'topic/watcher-name/container-name',
    }),
    { retain: true },
  );
});

test.each([
  {
    displayIcon: 'sh:nextcloud',
    expectedPicture: 'https://cdn.jsdelivr.net/gh/selfhst/icons/png/nextcloud.png',
  },
  {
    displayIcon: 'hl:nextcloud',
    expectedPicture: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/nextcloud.png',
  },
  {
    displayIcon: 'si:nextcloud',
    expectedPicture: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/nextcloud.svg',
  },
  {
    displayIcon: 'sh:   ',
    expectedPicture:
      'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
  },
])('addContainerSensor should map $displayIcon to entity_picture URL', async ({
  displayIcon,
  expectedPicture,
}) => {
  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon,
  });

  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.entity_picture).toBe(expectedPicture);
});

test('addContainerSensor should use direct URL icon as entity_picture', async () => {
  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'https://example.com/custom/icon.png',
  });

  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.entity_picture).toBe('https://example.com/custom/icon.png');
});

test('addContainerSensor should strip file extension from icon slug', async () => {
  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'sh:nextcloud.png',
  });

  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.entity_picture).toBe(
    'https://cdn.jsdelivr.net/gh/selfhst/icons/png/nextcloud.png',
  );
});

test('addContainerSensor should ignore empty dd.display.picture', async () => {
  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'sh:nextcloud',
    labels: {
      'dd.display.picture': '   ',
    },
  });

  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.entity_picture).toBe(
    'https://cdn.jsdelivr.net/gh/selfhst/icons/png/nextcloud.png',
  );
});

test('addContainerSensor should ignore non-URL dd.display.picture', async () => {
  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'sh:nextcloud',
    labels: {
      'dd.display.picture': 'not-a-url',
    },
  });

  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.entity_picture).toBe(
    'https://cdn.jsdelivr.net/gh/selfhst/icons/png/nextcloud.png',
  );
});

test('addContainerSensor should prefer dd.display.picture over icon-derived entity_picture', async () => {
  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'sh:nextcloud',
    labels: {
      'dd.display.picture': 'https://images.example.com/nextcloud.png',
    },
  });

  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.entity_picture).toBe('https://images.example.com/nextcloud.png');
});

test('addContainerSensor should fall back to wud.display.picture and warn about the legacy label', async () => {
  const recordLegacyInputSpy = vi.spyOn(compatibility, 'recordLegacyInput');
  const logWarnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'sh:nextcloud',
    labels: {
      'wud.display.picture': 'https://images.example.com/legacy-nextcloud.png',
    },
  });

  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.entity_picture).toBe('https://images.example.com/legacy-nextcloud.png');
  expect(recordLegacyInputSpy).toHaveBeenCalledWith('label', 'wud.display.picture');
  expect(logWarnSpy).toHaveBeenCalledWith(
    'Legacy Docker label "wud.display.picture" is deprecated. Please migrate to "dd.display.picture" before removal in v1.6.0.',
  );
});

test('addContainerSensor should fall through to wud.display.picture when dd.display.picture is an explicit empty string', async () => {
  // This call site previously read `dd.display.picture || wud.display.picture`,
  // which falls through to the wud.* label on an explicit empty dd.* value
  // (e.g. an unset compose-file env-substitution default), not just when
  // dd.* is absent. treatEmptyAsAbsent preserves that behavior so a
  // container that still relies on wud.display.picture doesn't silently
  // lose it. (The warn-message assertion is covered by the preceding test —
  // the legacy-label warned-fallback registry is deduped per key, so
  // asserting it again here would be order-dependent.)
  const recordLegacyInputSpy = vi.spyOn(compatibility, 'recordLegacyInput');

  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'sh:nextcloud',
    labels: {
      'dd.display.picture': '',
      'wud.display.picture': 'https://images.example.com/legacy-nextcloud.png',
    },
  });

  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.entity_picture).toBe('https://images.example.com/legacy-nextcloud.png');
  expect(recordLegacyInputSpy).toHaveBeenCalledWith('label', 'wud.display.picture');
});

test('addContainerSensor should warn once when multiple agents share a watcher name and the agent segment flag is disabled', async () => {
  const logWarnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  vi.spyOn(containerStore, 'getContainers').mockReturnValue([
    { id: 'c1', watcher: 'collision-watcher', agent: 'ml' },
    { id: 'c2', watcher: 'collision-watcher' },
  ] as any);

  await hass.addContainerSensor({
    name: 'nginx',
    watcher: 'collision-watcher',
    displayIcon: 'mdi:docker',
  });

  expect(logWarnSpy).toHaveBeenCalledWith(
    'Multiple agents share watcher name "collision-watcher" but the Home Assistant MQTT topic layout has no agent segment, so their topics/sensors will collide. Set DD_NOTIFICATION_MQTT_<name>_HASS_AGENTTOPICSEGMENT=true to opt into the corrected layout before it becomes the default in v1.7.0.',
  );

  logWarnSpy.mockClear();
  await hass.addContainerSensor({
    name: 'nginx',
    watcher: 'collision-watcher',
    displayIcon: 'mdi:docker',
  });
  expect(logWarnSpy).not.toHaveBeenCalled();
});

test('addContainerSensor should not warn when a watcher name has only one distinct agent', async () => {
  const logWarnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  vi.spyOn(containerStore, 'getContainers').mockReturnValue([
    { id: 'c1', watcher: 'single-agent-watcher', agent: 'ml' },
    { id: 'c2', watcher: 'single-agent-watcher', agent: 'ml' },
  ] as any);

  await hass.addContainerSensor({
    name: 'nginx',
    watcher: 'single-agent-watcher',
    displayIcon: 'mdi:docker',
  });

  expect(logWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Multiple agents share'));
});

test.each(
  containerData,
)('removeContainerSensor must publish sensor discovery message expected by HA', async ({
  containerName,
  data,
}) => {
  await hass.removeContainerSensor({
    name: containerName,
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });
  expect(mqttClientMock.publish).toHaveBeenCalledWith(data.discoveryTopic, '', {
    retain: true,
  });
});

test.each(containerData)('updateContainerSensors must publish all sensors expected by HA', async ({
  containerName,
  data,
}) => {
  await hass.updateContainerSensors({
    name: containerName,
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });
  expect(mqttClientMock.publish).toHaveBeenCalledTimes(15);

  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    1,
    'homeassistant/sensor/topic_total_count/config',
    JSON.stringify({
      unique_id: 'topic_total_count',
      default_entity_id: 'sensor.topic_total_count',
      name: 'Total container count',
      device: {
        identifiers: ['drydock'],
        manufacturer: 'drydock',
        model: 'drydock',
        name: 'drydock',
        sw_version: MOCK_VERSION,
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
      state_topic: 'topic/total_count',
    }),
    { retain: true },
  );

  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    2,
    'homeassistant/sensor/topic_update_count/config',
    JSON.stringify({
      unique_id: 'topic_update_count',
      default_entity_id: 'sensor.topic_update_count',
      name: 'Total container update count',
      device: {
        identifiers: ['drydock'],
        manufacturer: 'drydock',
        model: 'drydock',
        name: 'drydock',
        sw_version: MOCK_VERSION,
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
      state_topic: 'topic/update_count',
    }),
    { retain: true },
  );

  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    3,
    'homeassistant/binary_sensor/topic_update_status/config',
    JSON.stringify({
      unique_id: 'topic_update_status',
      default_entity_id: 'binary_sensor.topic_update_status',
      name: 'Total container update status',
      device: {
        identifiers: ['drydock'],
        manufacturer: 'drydock',
        model: 'drydock',
        name: 'drydock',
        sw_version: MOCK_VERSION,
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
      state_topic: 'topic/update_status',
      payload_on: 'true',
      payload_off: 'false',
    }),
    { retain: true },
  );

  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    4,
    'homeassistant/sensor/topic_watcher-name_total_count/config',
    JSON.stringify({
      unique_id: 'topic_watcher-name_total_count',
      default_entity_id: 'sensor.topic_watcher-name_total_count',
      name: 'Watcher watcher-name container count',
      device: {
        identifiers: ['drydock'],
        manufacturer: 'drydock',
        model: 'drydock',
        name: 'drydock',
        sw_version: MOCK_VERSION,
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
      state_topic: 'topic/watcher-name/total_count',
    }),
    { retain: true },
  );

  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    5,
    'homeassistant/sensor/topic_watcher-name_update_count/config',
    JSON.stringify({
      unique_id: 'topic_watcher-name_update_count',
      default_entity_id: 'sensor.topic_watcher-name_update_count',
      name: 'Watcher watcher-name container update count',
      device: {
        identifiers: ['drydock'],
        manufacturer: 'drydock',
        model: 'drydock',
        name: 'drydock',
        sw_version: MOCK_VERSION,
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
      state_topic: 'topic/watcher-name/update_count',
    }),
    { retain: true },
  );

  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    6,
    'homeassistant/binary_sensor/topic_watcher-name_update_status/config',
    JSON.stringify({
      unique_id: 'topic_watcher-name_update_status',
      default_entity_id: 'binary_sensor.topic_watcher-name_update_status',
      name: 'Watcher watcher-name container update status',
      device: {
        identifiers: ['drydock'],
        manufacturer: 'drydock',
        model: 'drydock',
        name: 'drydock',
        sw_version: MOCK_VERSION,
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
      state_topic: 'topic/watcher-name/update_status',
      payload_on: 'true',
      payload_off: 'false',
    }),
    { retain: true },
  );

  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(7, 'topic/total_count', '0', {
    retain: true,
  });
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(8, 'topic/update_count', '0', {
    retain: true,
  });
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(9, 'topic/update_status', 'false', {
    retain: true,
  });
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    10,
    'topic/watcher-name/total_count',
    '0',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    11,
    'topic/watcher-name/update_count',
    '0',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    12,
    'topic/watcher-name/update_status',
    'false',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    13,
    'homeassistant/sensor/topic_watcher-name_total_count/config',
    '',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    14,
    'homeassistant/sensor/topic_watcher-name_update_count/config',
    '',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    15,
    'homeassistant/binary_sensor/topic_watcher-name_update_status/config',
    '',
    { retain: true },
  );
});

test('updateContainerSensors should use container count queries instead of full list cloning', async () => {
  const getContainersSpy = vi.spyOn(containerStore, 'getContainers');
  const getContainerCountSpy = vi.spyOn(containerStore, 'getContainerCount');

  await hass.updateContainerSensors({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  expect(getContainerCountSpy).toHaveBeenCalledWith();
  expect(getContainerCountSpy).toHaveBeenCalledWith({ updateAvailable: true });
  expect(getContainerCountSpy).toHaveBeenCalledWith({ watcher: 'watcher-name' });
  expect(getContainerCountSpy).toHaveBeenCalledWith({
    watcher: 'watcher-name',
    updateAvailable: true,
  });
  expect(getContainersSpy).not.toHaveBeenCalled();
});

test.each(
  containerData,
)('removeContainerSensor must publish all sensor removal messages expected by HA', async ({
  containerName,
  data,
}) => {
  await hass.removeContainerSensor({
    name: containerName,
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });
  expect(mqttClientMock.publish).toHaveBeenCalledWith(data.discoveryTopic, '', {
    retain: true,
  });
});

test('updateWatcherSensors must publish all watcher sensor messages expected by HA', async () => {
  await hass.updateWatcherSensors({
    watcher: {
      name: 'watcher-name',
    },
    isRunning: true,
  });
  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/binary_sensor/topic_watcher-name_running/config',
    JSON.stringify({
      unique_id: 'topic_watcher-name_running',
      default_entity_id: 'binary_sensor.topic_watcher-name_running',
      name: 'Watcher watcher-name running status',
      device: {
        identifiers: ['drydock'],
        manufacturer: 'drydock',
        model: 'drydock',
        name: 'drydock',
        sw_version: MOCK_VERSION,
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/whale-logo.png',
      state_topic: 'topic/watcher-name/running',
      payload_on: 'true',
      payload_off: 'false',
    }),
    { retain: true },
  );
});

test('addContainerSensor should skip discovery when discovery is false', async () => {
  const hassNoDiscovery = new Hass({
    client: mqttClientMock,
    configuration: {
      topic: 'topic',
      hass: {
        discovery: false,
        prefix: 'homeassistant',
      },
    },
    log,
    isContainerAllowed: () => true,
  });
  vi.spyOn(hassNoDiscovery, 'publishDiscoveryMessage');
  vi.spyOn(hassNoDiscovery, 'updateContainerSensors').mockResolvedValue();
  await hassNoDiscovery.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });
  expect(hassNoDiscovery.publishDiscoveryMessage).not.toHaveBeenCalled();
  expect(hassNoDiscovery.updateContainerSensors).toHaveBeenCalled();
});

test('removeContainerSensor should skip discovery when discovery is false', async () => {
  const hassNoDiscovery = new Hass({
    client: mqttClientMock,
    configuration: {
      topic: 'topic',
      hass: {
        discovery: false,
        prefix: 'homeassistant',
      },
    },
    log,
    isContainerAllowed: () => true,
  });
  vi.spyOn(hassNoDiscovery, 'removeSensor');
  vi.spyOn(hassNoDiscovery, 'updateContainerSensors').mockResolvedValue();
  await hassNoDiscovery.removeContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });
  expect(hassNoDiscovery.removeSensor).not.toHaveBeenCalled();
  expect(hassNoDiscovery.updateContainerSensors).toHaveBeenCalled();
});

test('updateContainerSensors should skip discovery messages when discovery is false', async () => {
  const hassNoDiscovery = new Hass({
    client: mqttClientMock,
    configuration: {
      topic: 'topic',
      hass: {
        discovery: false,
        prefix: 'homeassistant',
      },
    },
    log,
    isContainerAllowed: () => true,
  });
  await hassNoDiscovery.updateContainerSensors({
    name: 'container-name',
    watcher: 'watcher-name',
  });
  // Should only publish state values (6 calls), not discovery messages (which would be 15)
  expect(mqttClientMock.publish).toHaveBeenCalledTimes(6);
});

test('updateWatcherSensors should skip discovery when discovery is false', async () => {
  const hassNoDiscovery = new Hass({
    client: mqttClientMock,
    configuration: {
      topic: 'topic',
      hass: {
        discovery: false,
        prefix: 'homeassistant',
      },
    },
    log,
    isContainerAllowed: () => true,
  });
  await hassNoDiscovery.updateWatcherSensors({
    watcher: { name: 'watcher-name' },
    isRunning: true,
  });
  // Should publish only the state value (1), not the discovery message
  expect(mqttClientMock.publish).toHaveBeenCalledTimes(1);
  expect(mqttClientMock.publish).toHaveBeenCalledWith('topic/watcher-name/running', 'true', {
    retain: true,
  });
});

test('addContainerSensor should pass release_url undefined when result is absent', async () => {
  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
    result: undefined,
  });
  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.release_url).toBeUndefined();
});

test('addContainerSensor should include release_url when result link is present', async () => {
  await hass.addContainerSensor({
    name: 'container-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
    result: {
      link: 'https://example.com/changelog',
    },
  });
  const discoveryCall = mqttClientMock.publish.mock.calls[0];
  const discoveryPayload = JSON.parse(discoveryCall[1]);
  expect(discoveryPayload.release_url).toBe('https://example.com/changelog');
});

test('publishDiscoveryMessage should use default icon when none provided', async () => {
  await hass.publishDiscoveryMessage({
    discoveryTopic: 'my/discovery',
    stateTopic: 'my/state',
    kind: 'sensor',
  });
  const payload = JSON.parse(mqttClientMock.publish.mock.calls[0][1]);
  expect(payload.icon).toBe('mdi:docker');
  expect(payload.name).toBe('my_state');
});

test('constructor should register event callbacks that invoke methods', async () => {
  const addSpy = vi.spyOn(hass, 'addContainerSensor').mockResolvedValue();
  const removeSpy = vi.spyOn(hass, 'removeContainerSensor').mockResolvedValue();
  const watcherSpy = vi.spyOn(hass, 'updateWatcherSensors').mockResolvedValue();

  // Get captured callbacks
  const containerAddedCb = registerContainerAdded.mock.calls[0][0];
  const containerUpdatedCb = registerContainerUpdated.mock.calls[0][0];
  const containerRemovedCb = registerContainerRemoved.mock.calls[0][0];
  const watcherStartCb = registerWatcherStart.mock.calls[0][0];
  const watcherStopCb = registerWatcherStop.mock.calls[0][0];

  const testContainer = { name: 'test', watcher: 'w1' };
  const testWatcher = { name: 'w1' };

  await containerAddedCb(testContainer);
  expect(addSpy).toHaveBeenCalledWith(testContainer);

  await containerUpdatedCb(testContainer);
  expect(addSpy).toHaveBeenCalledTimes(2);

  await containerRemovedCb(testContainer);
  expect(removeSpy).toHaveBeenCalledWith(testContainer);

  await watcherStartCb(testWatcher);
  expect(watcherSpy).toHaveBeenCalledWith({ watcher: testWatcher, isRunning: true });

  await watcherStopCb(testWatcher);
  expect(watcherSpy).toHaveBeenCalledWith({ watcher: testWatcher, isRunning: false });
});

test('addContainerSensor should handle container with empty watcher gracefully', async () => {
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);
  await hass.addContainerSensor({
    id: 'container-id-123',
    name: 'container-name',
    watcher: '',
    displayIcon: 'mdi:docker',
  });
  // Should still publish (no stale topic cleanup attempted when watcher is empty)
  expect(mqttClientMock.publish).toHaveBeenCalled();
});

test('addContainerSensor should handle container with non-string watcher gracefully', async () => {
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);
  await hass.addContainerSensor({
    id: 'container-id-123',
    name: 'container-name',
    watcher: undefined,
    displayIcon: 'mdi:docker',
  });
  expect(mqttClientMock.publish).toHaveBeenCalled();
});

test('addContainerSensor should not duplicate stale topic when it matches current topic', async () => {
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);

  // Add with alias name — canonical resolves to same as stale candidate
  await hass.addContainerSensor({
    id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
    name: '7ea6b8a42686_termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  // The stale alias topic should be removed, the canonical published
  const publishCalls = mqttClientMock.publish.mock.calls;
  // canonical topic should appear exactly once as a non-empty publish
  const canonicalPublishes = publishCalls.filter(
    ([topic, payload]) =>
      topic === 'homeassistant/update/topic_watcher-name_termix/config' && payload !== '',
  );
  expect(canonicalPublishes).toHaveLength(1);
});

test('getStaleContainerStateTopics should ignore stale aliases that already match the current topic', () => {
  const hassWithInternals = hass as unknown as {
    getStaleContainerStateTopics: (args: {
      container: { id?: unknown; name?: unknown; watcher?: unknown };
      currentStateTopic: string;
    }) => string[];
  };

  const staleStateTopics = hassWithInternals.getStaleContainerStateTopics({
    container: {
      id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
      name: '7ea6b8a42686_termix',
      watcher: 'watcher-name',
    },
    currentStateTopic: 'topic/watcher-name/7ea6b8a42686_termix',
  });

  expect(staleStateTopics).toEqual([]);
});

test('removeContainerSensor should clean up stale tracked topic when container id was previously tracked', async () => {
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);

  // First add with one name to track the topic by id
  await hass.addContainerSensor({
    id: 'container-id-456',
    name: 'old-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  mqttClientMock.publish.mockClear();

  // Now remove with a different name — should also remove the old tracked topic
  await hass.removeContainerSensor({
    id: 'container-id-456',
    name: 'new-name',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  // Should have removed both current and stale discovery topics
  const removeCalls = mqttClientMock.publish.mock.calls.filter(([, payload]) => payload === '');
  expect(removeCalls.length).toBeGreaterThanOrEqual(2);
  const removedTopics = removeCalls.map(([topic]) => topic);
  expect(removedTopics).toContain('homeassistant/update/topic_watcher-name_new-name/config');
  expect(removedTopics).toContain('homeassistant/update/topic_watcher-name_old-name/config');
});

test('removeContainerSensor should keep a canonical topic when another live container still uses it', async () => {
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);

  await hass.addContainerSensor({
    id: 'old-container-id',
    name: 'termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });
  await hass.addContainerSensor({
    id: 'new-container-id',
    name: 'termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  mqttClientMock.publish.mockClear();

  vi.spyOn(containerStore, 'getContainers').mockReturnValue([
    {
      id: 'new-container-id',
      name: 'termix',
      watcher: 'watcher-name',
      displayIcon: 'mdi:docker',
    },
  ] as any);

  await hass.removeContainerSensor({
    id: 'old-container-id',
    name: 'termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  expect(mqttClientMock.publish).not.toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_termix/config',
    '',
    { retain: true },
  );
});

test('removeContainerSensor should keep a canonical topic when a replacement container is still tracked during store lag', async () => {
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);

  await hass.addContainerSensor({
    id: 'old-container-id',
    name: 'termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });
  await hass.addContainerSensor({
    id: 'new-container-id',
    name: 'termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  mqttClientMock.publish.mockClear();

  vi.spyOn(containerStore, 'getContainers').mockReturnValue([] as any);

  await hass.removeContainerSensor({
    id: 'old-container-id',
    name: 'termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  expect(mqttClientMock.publish).not.toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_termix/config',
    '',
    { retain: true },
  );
});

test('removeContainerSensor should not remove discovery when a same-name replacement is expected', async () => {
  const logInfoSpy = vi.spyOn(log, 'info').mockImplementation(() => {});
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);

  await hass.addContainerSensor({
    id: 'old-container-id',
    name: 'termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
  });

  mqttClientMock.publish.mockClear();

  vi.spyOn(containerStore, 'getContainers').mockReturnValue([] as any);

  await hass.removeContainerSensor({
    id: 'old-container-id',
    name: 'termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
    replacementExpected: true,
  });

  expect(mqttClientMock.publish).not.toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_termix/config',
    '',
    { retain: true },
  );
  expect(logInfoSpy).toHaveBeenCalledWith(
    'Skip hass container update sensor removal [topic/watcher-name/termix]',
  );
});

test('removeContainerSensor should log canonical preservation when only stale alias topics are removed', async () => {
  const logInfoSpy = vi.spyOn(log, 'info').mockImplementation(() => {});
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);
  vi.spyOn(containerStore, 'getContainers').mockReturnValue([] as any);

  await hass.removeContainerSensor({
    id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
    name: '7ea6b8a42686_termix',
    watcher: 'watcher-name',
    displayIcon: 'mdi:docker',
    replacementExpected: true,
  });

  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_7ea6b8a42686_termix/config',
    '',
    { retain: true },
  );
  expect(mqttClientMock.publish).not.toHaveBeenCalledWith(
    'homeassistant/update/topic_watcher-name_termix/config',
    '',
    { retain: true },
  );
  expect(logInfoSpy).toHaveBeenCalledWith(
    'Preserve canonical hass container update sensor [topic/watcher-name/termix]; removing stale alias topics [topic/watcher-name/7ea6b8a42686_termix]',
  );
});

test('removeContainerSensor should still remove topic when watcher name is empty', async () => {
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);

  await hass.addContainerSensor({
    id: 'container-1',
    name: 'app',
    watcher: '',
    displayIcon: 'mdi:docker',
  });

  mqttClientMock.publish.mockClear();

  await hass.removeContainerSensor({
    id: 'container-1',
    name: 'app',
    watcher: '',
    displayIcon: 'mdi:docker',
  });

  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic__app/config',
    '',
    { retain: true },
  );
});

test('removeContainerSensor should still remove topic when store throws', async () => {
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);

  await hass.addContainerSensor({
    id: 'container-1',
    name: 'app',
    watcher: 'local',
    displayIcon: 'mdi:docker',
  });

  mqttClientMock.publish.mockClear();
  vi.spyOn(containerStore, 'getContainers').mockImplementation(() => {
    throw new Error('store unavailable');
  });

  await hass.removeContainerSensor({
    id: 'container-1',
    name: 'app',
    watcher: 'local',
    displayIcon: 'mdi:docker',
  });

  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_local_app/config',
    '',
    { retain: true },
  );
});

test('removeContainerSensor should still remove topic when watcher is not a string', async () => {
  vi.spyOn(hass, 'updateContainerSensors').mockResolvedValue(undefined);

  await hass.addContainerSensor({
    id: 'container-1',
    name: 'app',
    watcher: undefined,
    displayIcon: 'mdi:docker',
  });

  mqttClientMock.publish.mockClear();

  await hass.removeContainerSensor({
    id: 'container-1',
    name: 'app',
    watcher: undefined,
    displayIcon: 'mdi:docker',
  });

  expect(mqttClientMock.publish).toHaveBeenCalledWith(
    'homeassistant/update/topic_undefined_app/config',
    '',
    { retain: true },
  );
});

test('addContainerSensor should enforce a defensive cap on tracked state topics', async () => {
  const hassNoDiscovery = new Hass({
    client: mqttClientMock,
    configuration: {
      topic: 'topic',
      hass: {
        discovery: false,
        prefix: 'homeassistant',
      },
    },
    log,
    isContainerAllowed: () => true,
  });

  const hassWithInternalMap = hassNoDiscovery as unknown as {
    containerStateTopicById: Map<string, string>;
    enforceContainerStateTopicTrackLimit: () => void;
  };
  for (let index = 0; index <= HASS_CONTAINER_STATE_TOPIC_TRACK_LIMIT + 1; index += 1) {
    hassWithInternalMap.containerStateTopicById.set(
      `container-id-${index}`,
      `topic/watcher-name/container-name-${index}`,
    );
  }

  hassWithInternalMap.enforceContainerStateTopicTrackLimit();

  expect(hassWithInternalMap.containerStateTopicById.size).toBe(
    HASS_CONTAINER_STATE_TOPIC_TRACK_LIMIT,
  );
  expect(hassWithInternalMap.containerStateTopicById.has('container-id-0')).toBe(false);
  expect(hassWithInternalMap.containerStateTopicById.has('container-id-1')).toBe(false);
  expect(hassWithInternalMap.containerStateTopicById.has('container-id-2')).toBe(true);
});

test('deregister should invoke event unregister callbacks', async () => {
  const unregisterContainerAdded = vi.fn();
  const unregisterContainerUpdated = vi.fn();
  const unregisterContainerRemoved = vi.fn();
  const unregisterWatcherStart = vi.fn();
  const unregisterWatcherStop = vi.fn();
  registerContainerAdded.mockReturnValue(unregisterContainerAdded);
  registerContainerUpdated.mockReturnValue(unregisterContainerUpdated);
  registerContainerRemoved.mockReturnValue(unregisterContainerRemoved);
  registerWatcherStart.mockReturnValue(unregisterWatcherStart);
  registerWatcherStop.mockReturnValue(unregisterWatcherStop);

  const hassWithUnregisterCallbacks = new Hass({
    client: mqttClientMock,
    configuration: {
      topic: 'topic',
      hass: {
        discovery: true,
        prefix: 'homeassistant',
      },
    },
    log,
    isContainerAllowed: () => true,
  });

  hassWithUnregisterCallbacks.deregister();

  expect(unregisterContainerAdded).toHaveBeenCalledTimes(1);
  expect(unregisterContainerUpdated).toHaveBeenCalledTimes(1);
  expect(unregisterContainerRemoved).toHaveBeenCalledTimes(1);
  expect(unregisterWatcherStart).toHaveBeenCalledTimes(1);
  expect(unregisterWatcherStop).toHaveBeenCalledTimes(1);
});

// ── #491: hass sensor sync respects isContainerAllowed gating ───────────────

describe('hass sensor sync gating by isContainerAllowed (#491)', () => {
  let mqttClientGatedMock: { publish: ReturnType<typeof vi.fn> };
  let isContainerAllowedMock: ReturnType<typeof vi.fn>;
  let gatedHass: Hass;

  beforeEach(() => {
    vi.resetAllMocks();
    mqttClientGatedMock = { publish: vi.fn(() => {}) };
    isContainerAllowedMock = vi.fn().mockReturnValue(true);
    gatedHass = new Hass({
      client: mqttClientGatedMock,
      configuration: {
        topic: 'topic',
        hass: {
          discovery: true,
          prefix: 'homeassistant',
        },
      },
      log,
      isContainerAllowed: (container) => isContainerAllowedMock(container),
    });
  });

  test('containerAdded for an excluded container publishes the removal payload, not a discovery add', async () => {
    isContainerAllowedMock.mockReturnValue(false);
    const containerAddedCb = registerContainerAdded.mock.calls.at(-1)[0];

    await containerAddedCb({ id: 'ctr-excluded', name: 'nginx', watcher: 'local' });

    expect(mqttClientGatedMock.publish).toHaveBeenCalledWith(
      'homeassistant/update/topic_local_nginx/config',
      '',
      { retain: true },
    );
    const discoveryAddPublishes = mqttClientGatedMock.publish.mock.calls.filter(
      ([topic, payload]) =>
        topic === 'homeassistant/update/topic_local_nginx/config' && payload !== '',
    );
    expect(discoveryAddPublishes).toHaveLength(0);
  });

  test('a second event for the same still-excluded container does not repeat the removal; debug skip is logged', async () => {
    isContainerAllowedMock.mockReturnValue(false);
    const containerAddedCb = registerContainerAdded.mock.calls.at(-1)[0];
    const container = { id: 'ctr-excluded-2', name: 'redis', watcher: 'local' };

    await containerAddedCb(container);
    mqttClientGatedMock.publish.mockClear();
    const debugSpy = vi.spyOn(log, 'debug').mockImplementation(() => {});

    await containerAddedCb(container);

    expect(mqttClientGatedMock.publish).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      'Skip hass sensor sync for excluded container [topic/local/redis]',
    );
  });

  test('flipping a container from excluded to included publishes a discovery add; flipping back publishes removal again', async () => {
    const containerUpdatedCb = registerContainerUpdated.mock.calls.at(-1)[0];
    const container = { id: 'ctr-flip', name: 'nginx', watcher: 'local' };

    isContainerAllowedMock.mockReturnValue(false);
    await containerUpdatedCb(container);
    mqttClientGatedMock.publish.mockClear();

    isContainerAllowedMock.mockReturnValue(true);
    await containerUpdatedCb(container);
    const addCall = mqttClientGatedMock.publish.mock.calls.find(
      ([topic]) => topic === 'homeassistant/update/topic_local_nginx/config',
    );
    expect(addCall?.[1]).not.toBe('');
    mqttClientGatedMock.publish.mockClear();

    isContainerAllowedMock.mockReturnValue(false);
    await containerUpdatedCb(container);
    expect(mqttClientGatedMock.publish).toHaveBeenCalledWith(
      'homeassistant/update/topic_local_nginx/config',
      '',
      { retain: true },
    );
  });

  test('excluded container with no id derives its sync key from the state topic; the dedupe still works', async () => {
    isContainerAllowedMock.mockReturnValue(false);
    const containerAddedCb = registerContainerAdded.mock.calls.at(-1)[0];
    const container = { id: undefined, name: 'no-id-app', watcher: 'local' };

    await containerAddedCb(container);
    expect(mqttClientGatedMock.publish).toHaveBeenCalledWith(
      'homeassistant/update/topic_local_no-id-app/config',
      '',
      { retain: true },
    );

    mqttClientGatedMock.publish.mockClear();
    await containerAddedCb(container);
    expect(mqttClientGatedMock.publish).not.toHaveBeenCalled();
  });

  test('containerRemoved drops a previously-excluded container key so a later add while still excluded cleans again', async () => {
    isContainerAllowedMock.mockReturnValue(false);
    const containerAddedCb = registerContainerAdded.mock.calls.at(-1)[0];
    const containerRemovedCb = registerContainerRemoved.mock.calls.at(-1)[0];
    const container = { id: 'ctr-removed-flow', name: 'nginx', watcher: 'local' };

    await containerAddedCb(container);
    mqttClientGatedMock.publish.mockClear();

    // Still excluded — deduped, no publish (sanity check before removal).
    await containerAddedCb(container);
    expect(mqttClientGatedMock.publish).not.toHaveBeenCalled();

    await containerRemovedCb(container);
    mqttClientGatedMock.publish.mockClear();

    // Key was dropped on removal, so the next excluded add cleans again.
    await containerAddedCb(container);
    expect(mqttClientGatedMock.publish).toHaveBeenCalledWith(
      'homeassistant/update/topic_local_nginx/config',
      '',
      { retain: true },
    );
  });

  test('deregister clears cleanedExcludedContainerKeys', async () => {
    isContainerAllowedMock.mockReturnValue(false);
    const containerAddedCb = registerContainerAdded.mock.calls.at(-1)[0];
    const container = { id: 'ctr-deregister', name: 'nginx', watcher: 'local' };
    await containerAddedCb(container);

    const internalSet = (gatedHass as unknown as { cleanedExcludedContainerKeys: Set<string> })
      .cleanedExcludedContainerKeys;
    expect(internalSet.size).toBe(1);

    await gatedHass.deregister();

    expect(internalSet.size).toBe(0);
  });

  test('a command message for a container the predicate rejects is ignored: no update requested, warn logged, no audit event', async () => {
    const capableClient = makeCapableClientMock();
    const isContainerAllowedForCommands = vi.fn().mockReturnValue(false);
    const commandsHass = new Hass({
      client: capableClient,
      configuration: {
        topic: 'topic',
        hass: { discovery: true, prefix: 'homeassistant', commands: true },
      },
      log,
      isContainerAllowed: isContainerAllowedForCommands,
    });
    await commandsHass.initCommandSubscription();

    const container = { id: 'ctr-excluded-cmd', name: 'nginx', watcher: 'local' };
    vi.spyOn(containerStore, 'getContainers').mockReturnValue([container] as any);
    const requestSpy = vi.spyOn(requestUpdateModule, 'requestContainerUpdate');
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

    const commandTopic = getHassCommandTopicFromStateTopic(
      commandsHass.getContainerStateTopic({ container }),
    );
    await fireCommandMessage(capableClient, commandTopic, 'install', { retain: false });

    expect(requestSpy).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Ignoring hass install command for [nginx]: container is excluded from this trigger',
    );
  });
});

// ── #386: agenttopicsegment flag ─────────────────────────────────────────────

describe('agenttopicsegment flag', () => {
  let hassAgent: InstanceType<typeof Hass>;
  let mqttClientAgentMock: { publish: ReturnType<typeof vi.fn> };

  function makeHass(agenttopicsegment: boolean) {
    return new Hass({
      client: mqttClientAgentMock,
      configuration: {
        topic: 'topic',
        hass: {
          discovery: true,
          prefix: 'homeassistant',
          agenttopicsegment,
        },
      },
      log,
      isContainerAllowed: () => true,
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mqttClientAgentMock = { publish: vi.fn(() => {}) };
    hassAgent = makeHass(true);
  });

  // ── Topic construction ──────────────────────────────────────────────────────

  describe('topic construction', () => {
    test('flag OFF — agent container topic is unchanged (no agent segment)', () => {
      const hassOff = makeHass(false);
      const topic = hassOff.getContainerStateTopic({
        container: { name: 'nginx', watcher: 'local', agent: 'ml' },
      });
      expect(topic).toBe('topic/local/nginx');
    });

    test('flag ON — agent container topic includes agent/<name> segment', () => {
      const topic = hassAgent.getContainerStateTopic({
        container: { name: 'nginx', watcher: 'local', agent: 'ml' },
      });
      expect(topic).toBe('topic/agent/ml/local/nginx');
    });

    test('flag ON — no-agent container topic is UNCHANGED', () => {
      const topic = hassAgent.getContainerStateTopic({
        container: { name: 'nginx', watcher: 'local', agent: undefined },
      });
      expect(topic).toBe('topic/local/nginx');
    });

    test('flag ON — empty-string agent is treated as no-agent (topic unchanged)', () => {
      const topic = hassAgent.getContainerStateTopic({
        container: { name: 'nginx', watcher: 'local', agent: '' },
      });
      expect(topic).toBe('topic/local/nginx');
    });

    test('flag ON — two different agents on same watcher+container produce distinct topics', () => {
      const topicMl = hassAgent.getContainerStateTopic({
        container: { name: 'nginx', watcher: 'local', agent: 'ml' },
      });
      const topicEdge = hassAgent.getContainerStateTopic({
        container: { name: 'nginx', watcher: 'local', agent: 'edge' },
      });
      expect(topicMl).toBe('topic/agent/ml/local/nginx');
      expect(topicEdge).toBe('topic/agent/edge/local/nginx');
      expect(topicMl).not.toBe(topicEdge);
    });

    test('flag ON — addContainerSensor publishes discovery with agent topic', async () => {
      vi.spyOn(hassAgent, 'updateContainerSensors').mockResolvedValue(undefined);
      await hassAgent.addContainerSensor({
        id: 'ctr-ml-1',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });
      const discoveryCall = mqttClientAgentMock.publish.mock.calls.find(([topic]) =>
        topic.startsWith('homeassistant/update/'),
      );
      expect(discoveryCall).toBeDefined();
      expect(discoveryCall[0]).toBe('homeassistant/update/topic_agent_ml_local_nginx/config');
      const payload = JSON.parse(discoveryCall[1]);
      expect(payload.state_topic).toBe('topic/agent/ml/local/nginx');
    });

    test('flag ON — addContainerSensor for no-agent container uses legacy topic', async () => {
      vi.spyOn(hassAgent, 'updateContainerSensors').mockResolvedValue(undefined);
      await hassAgent.addContainerSensor({
        id: 'ctr-local-1',
        name: 'nginx',
        watcher: 'local',
        agent: undefined,
        displayIcon: 'mdi:docker',
      });
      const discoveryCall = mqttClientAgentMock.publish.mock.calls.find(([topic]) =>
        topic.startsWith('homeassistant/update/'),
      );
      expect(discoveryCall).toBeDefined();
      expect(discoveryCall[0]).toBe('homeassistant/update/topic_local_nginx/config');
      const payload = JSON.parse(discoveryCall[1]);
      expect(payload.state_topic).toBe('topic/local/nginx');
    });
  });

  // ── Watcher sensor topic construction ──────────────────────────────────────

  describe('watcher sensor topics', () => {
    test('flag OFF — watcher sensor topics are unchanged even when container has agent', async () => {
      const hassOff = makeHass(false);
      vi.spyOn(containerStore, 'getContainerCount').mockReturnValue(0);
      await hassOff.updateContainerSensors({
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
      });
      // Should use the legacy unscoped watcher prefix
      const sensorTopicCalls = mqttClientAgentMock.publish.mock.calls.map(([topic]) => topic);
      expect(sensorTopicCalls).toContain('topic/local/total_count');
      expect(sensorTopicCalls).not.toContain(expect.stringContaining('agent/ml'));
    });

    test('flag ON — watcher sensor topics include agent segment for agent container', async () => {
      vi.spyOn(containerStore, 'getContainerCount').mockReturnValue(0);
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([]);
      await hassAgent.updateContainerSensors({
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
      });
      const sensorTopicCalls = mqttClientAgentMock.publish.mock.calls.map(([topic]) => topic);
      expect(sensorTopicCalls).toContain('topic/agent/ml/local/total_count');
      expect(sensorTopicCalls).toContain('topic/agent/ml/local/update_count');
      expect(sensorTopicCalls).toContain('topic/agent/ml/local/update_status');
    });

    test('flag ON — watcher sensor topics are unchanged for no-agent container', async () => {
      vi.spyOn(containerStore, 'getContainerCount').mockReturnValue(0);
      await hassAgent.updateContainerSensors({
        name: 'nginx',
        watcher: 'local',
        agent: undefined,
      });
      const sensorTopicCalls = mqttClientAgentMock.publish.mock.calls.map(([topic]) => topic);
      expect(sensorTopicCalls).toContain('topic/local/total_count');
      expect(sensorTopicCalls).not.toContain('topic/agent/undefined/local/total_count');
    });
  });

  // ── Watcher running sensor topic construction ──────────────────────────────

  describe('watcher running sensor topics', () => {
    test('flag ON — agent watcher running topic includes agent segment', async () => {
      await hassAgent.updateWatcherSensors({
        watcher: { name: 'local', agent: 'ml' },
        isRunning: true,
      });

      expect(mqttClientAgentMock.publish).toHaveBeenCalledWith(
        'homeassistant/binary_sensor/topic_agent_ml_local_running/config',
        expect.stringContaining('"state_topic":"topic/agent/ml/local/running"'),
        { retain: true },
      );
      expect(mqttClientAgentMock.publish).toHaveBeenCalledWith(
        'topic/agent/ml/local/running',
        'true',
        { retain: true },
      );
    });

    test('flag OFF — agent watcher running topic preserves legacy layout', async () => {
      const hassOff = makeHass(false);

      await hassOff.updateWatcherSensors({
        watcher: { name: 'local', agent: 'ml' },
        isRunning: true,
      });

      expect(mqttClientAgentMock.publish).toHaveBeenCalledWith(
        'homeassistant/binary_sensor/topic_local_running/config',
        expect.stringContaining('"state_topic":"topic/local/running"'),
        { retain: true },
      );
      expect(mqttClientAgentMock.publish).toHaveBeenCalledWith('topic/local/running', 'true', {
        retain: true,
      });
    });

    test('flag ON — same watcher name across agents publishes distinct running discovery identifiers', async () => {
      await hassAgent.updateWatcherSensors({
        watcher: { name: 'local', agent: 'ml' },
        isRunning: true,
      });
      await hassAgent.updateWatcherSensors({
        watcher: { name: 'local', agent: 'edge' },
        isRunning: true,
      });

      const discoveryPayloads = mqttClientAgentMock.publish.mock.calls
        .filter(([topic]) => topic.startsWith('homeassistant/binary_sensor/'))
        .map(([topic, payload]) => ({
          topic,
          payload: JSON.parse(payload),
        }));

      expect(discoveryPayloads.map(({ topic }) => topic)).toEqual([
        'homeassistant/binary_sensor/topic_agent_ml_local_running/config',
        'homeassistant/binary_sensor/topic_agent_edge_local_running/config',
      ]);
      expect(discoveryPayloads.map(({ payload }) => payload.unique_id)).toEqual([
        'topic_agent_ml_local_running',
        'topic_agent_edge_local_running',
      ]);
    });
  });

  // ── Watcher count scoping ──────────────────────────────────────────────────

  describe('watcher count scoping', () => {
    test('flag OFF — watcher counts sum across all agents (legacy behavior)', async () => {
      const getContainerCountSpy = vi.spyOn(containerStore, 'getContainerCount').mockReturnValue(3);
      vi.spyOn(containerStore, 'getContainers');
      const hassOff = makeHass(false);
      await hassOff.updateContainerSensors({
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
      });
      // Should use getContainerCount, NOT getContainers for watcher scoping
      expect(getContainerCountSpy).toHaveBeenCalledWith({ watcher: 'local' });
      expect(getContainerCountSpy).toHaveBeenCalledWith({
        watcher: 'local',
        updateAvailable: true,
      });
      // In flag-off mode, counts come from getContainerCount only
      const countCalls = getContainerCountSpy.mock.calls;
      expect(
        countCalls.some((c) => JSON.stringify(c[0]) === JSON.stringify({ watcher: 'local' })),
      ).toBe(true);
    });

    test('flag ON — watcher counts are scoped to agent via getContainers filter', async () => {
      const mlContainer = { id: 'c1', watcher: 'local', agent: 'ml', updateAvailable: false };
      const mlContainerUpdate = { id: 'c2', watcher: 'local', agent: 'ml', updateAvailable: true };
      const otherAgentContainer = {
        id: 'c3',
        watcher: 'local',
        agent: 'edge',
        updateAvailable: true,
      };
      vi.spyOn(containerStore, 'getContainerCount').mockReturnValue(0);
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([
        mlContainer,
        mlContainerUpdate,
        otherAgentContainer,
      ] as any);

      let capturedWatcherTotalCountValue: string | undefined;
      let capturedWatcherUpdateCountValue: string | undefined;
      mqttClientAgentMock.publish.mockImplementation((topic: string, value: string) => {
        if (topic === 'topic/agent/ml/local/total_count') capturedWatcherTotalCountValue = value;
        if (topic === 'topic/agent/ml/local/update_count') capturedWatcherUpdateCountValue = value;
      });

      await hassAgent.updateContainerSensors({
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
      });

      // Only ml-agent containers should be counted (2 total, 1 with update)
      expect(capturedWatcherTotalCountValue).toBe('2');
      expect(capturedWatcherUpdateCountValue).toBe('1');
    });

    test('flag ON — no-agent watcher counts exclude remote-agent containers', async () => {
      vi.spyOn(containerStore, 'getContainerCount').mockReturnValue(0);
      const getContainersSpy = vi.spyOn(containerStore, 'getContainers').mockReturnValue([
        { id: 'c1', watcher: 'local', agent: undefined, updateAvailable: false },
        { id: 'c2', watcher: 'local', agent: undefined, updateAvailable: true },
        { id: 'c3', watcher: 'local', agent: 'edge', updateAvailable: true },
      ] as any);
      let capturedWatcherTotalCountValue: string | undefined;
      let capturedWatcherUpdateCountValue: string | undefined;
      mqttClientAgentMock.publish.mockImplementation((topic: string, value: string) => {
        if (topic === 'topic/local/total_count') {
          capturedWatcherTotalCountValue = value;
        }
        if (topic === 'topic/local/update_count') {
          capturedWatcherUpdateCountValue = value;
        }
      });

      await hassAgent.updateContainerSensors({
        name: 'nginx',
        watcher: 'local',
        agent: undefined,
      });

      expect(getContainersSpy).toHaveBeenCalledWith({ watcher: 'local' });
      expect(capturedWatcherTotalCountValue).toBe('2');
      expect(capturedWatcherUpdateCountValue).toBe('1');
    });
  });

  // ── Discovery cleanup scoping ───────────────────────────────────────────────

  describe('discovery cleanup scoping', () => {
    test('flag ON — removing agent-A container does NOT suppress agent-B same-name container', async () => {
      vi.spyOn(hassAgent, 'updateContainerSensors').mockResolvedValue(undefined);

      // Track agent-A and agent-B containers with same watcher+name
      await hassAgent.addContainerSensor({
        id: 'agent-a-ctr',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });
      await hassAgent.addContainerSensor({
        id: 'agent-b-ctr',
        name: 'nginx',
        watcher: 'local',
        agent: 'edge',
        displayIcon: 'mdi:docker',
      });

      mqttClientAgentMock.publish.mockClear();

      // Store returns agent-B's container (agent-A is being removed)
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([
        { id: 'agent-b-ctr', name: 'nginx', watcher: 'local', agent: 'edge' },
      ] as any);

      // Remove agent-A's container
      await hassAgent.removeContainerSensor({
        id: 'agent-a-ctr',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });

      // agent-A's discovery topic should be removed
      expect(mqttClientAgentMock.publish).toHaveBeenCalledWith(
        'homeassistant/update/topic_agent_ml_local_nginx/config',
        '',
        { retain: true },
      );

      // agent-B's discovery topic should NOT be removed
      expect(mqttClientAgentMock.publish).not.toHaveBeenCalledWith(
        'homeassistant/update/topic_agent_edge_local_nginx/config',
        '',
        { retain: true },
      );
    });

    test('flag ON — removing agent container is suppressed by same-agent same-name active container', async () => {
      vi.spyOn(hassAgent, 'updateContainerSensors').mockResolvedValue(undefined);

      // Add old and new containers for same agent
      await hassAgent.addContainerSensor({
        id: 'old-ml-ctr',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });
      await hassAgent.addContainerSensor({
        id: 'new-ml-ctr',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });

      mqttClientAgentMock.publish.mockClear();

      // Store returns the new container (same agent)
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([
        { id: 'new-ml-ctr', name: 'nginx', watcher: 'local', agent: 'ml' },
      ] as any);

      // Remove old container
      await hassAgent.removeContainerSensor({
        id: 'old-ml-ctr',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });

      // Discovery topic should NOT be removed because same-agent new container is still active
      expect(mqttClientAgentMock.publish).not.toHaveBeenCalledWith(
        'homeassistant/update/topic_agent_ml_local_nginx/config',
        '',
        { retain: true },
      );
    });

    test('flag ON — tracked topic prefix is agent-scoped (no leak from different agent tracked topics)', async () => {
      vi.spyOn(hassAgent, 'updateContainerSensors').mockResolvedValue(undefined);

      // Add agent-B's container (tracked in map)
      await hassAgent.addContainerSensor({
        id: 'agent-b-tracked',
        name: 'nginx',
        watcher: 'local',
        agent: 'edge',
        displayIcon: 'mdi:docker',
      });

      mqttClientAgentMock.publish.mockClear();

      // Store returns empty (no active containers)
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([] as any);

      // Remove agent-A's container (not tracked, just store-looked-up)
      await hassAgent.removeContainerSensor({
        id: 'agent-a-only',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });

      // agent-B's tracked topic (edge) should NOT suppress removal of agent-A's topic (ml)
      expect(mqttClientAgentMock.publish).toHaveBeenCalledWith(
        'homeassistant/update/topic_agent_ml_local_nginx/config',
        '',
        { retain: true },
      );
    });

    test('flag OFF — cross-agent store entries are NOT filtered (legacy behavior)', async () => {
      const hassOff = makeHass(false);
      vi.spyOn(hassOff, 'updateContainerSensors').mockResolvedValue(undefined);

      await hassOff.addContainerSensor({
        id: 'old-ctr',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });

      mqttClientAgentMock.publish.mockClear();

      // Store returns a container with a DIFFERENT agent but same watcher+name
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([
        { id: 'other-agent-ctr', name: 'nginx', watcher: 'local', agent: 'edge' },
      ] as any);

      await hassOff.removeContainerSensor({
        id: 'old-ctr',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });

      // Without scoping, the other-agent container is treated as blocking removal
      expect(mqttClientAgentMock.publish).not.toHaveBeenCalledWith(
        'homeassistant/update/topic_local_nginx/config',
        '',
        { retain: true },
      );
    });
  });
});

// ── #210: hass install commands (bidirectional MQTT / HA Install button) ────

describe('hass install commands (#210)', () => {
  describe('discovery payload', () => {
    test('hass.commands false/absent: discovery payload has no command_topic/payload_install/extra qos/retain', async () => {
      // `hass` (top-level fixture) is configured without a `commands` key.
      await hass.addContainerSensor({
        name: 'container-name',
        watcher: 'watcher-name',
        displayIcon: 'mdi:docker',
      });
      const discoveryCall = mqttClientMock.publish.mock.calls[0];
      const discoveryPayload = JSON.parse(discoveryCall[1]);
      expect(discoveryPayload).not.toHaveProperty('command_topic');
      expect(discoveryPayload).not.toHaveProperty('payload_install');
      expect(discoveryPayload).not.toHaveProperty('qos');
      expect(discoveryPayload).not.toHaveProperty('retain');
    });

    test('hass.commands true + discovery true: payload includes command_topic/payload_install/qos/retain', async () => {
      // #210 bug fix — the command_topic gate now requires a *live* command
      // subscription, not just the config flag, so establish one first via
      // a capable client before asserting the discovery payload.
      const capableClient = makeCapableClientMock();
      const commandsHass = new Hass({
        client: capableClient,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await commandsHass.initCommandSubscription();
      await commandsHass.addContainerSensor({
        name: 'container-name',
        watcher: 'watcher-name',
        displayIcon: 'mdi:docker',
      });
      const discoveryCall = capableClient.publish.mock.calls.find(([topic]) =>
        topic.startsWith('homeassistant/update/'),
      );
      const discoveryPayload = JSON.parse(discoveryCall[1]);
      expect(discoveryPayload.command_topic).toBe('topic/watcher-name/container-name/cmd');
      expect(discoveryPayload.payload_install).toBe('install');
      expect(discoveryPayload.qos).toBe(1);
      expect(discoveryPayload.retain).toBe(false);
    });

    test('hass.commands true + subscribeAsync rejects: discovery payload omits command_topic/payload_install/qos/retain', async () => {
      // #210 regression — a broker ACL that denies subscribe (but allows
      // publish) must not advertise a dead Install button: commandSubscriptionActive
      // stays false when initCommandSubscription's subscribeAsync rejects.
      const capableClient = makeCapableClientMock();
      capableClient.subscribeAsync.mockRejectedValue(new Error('ACL denied'));
      const logWarnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      const commandsHass = new Hass({
        client: capableClient,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await commandsHass.initCommandSubscription();
      expect(logWarnSpy).toHaveBeenCalledWith(
        'Failed to subscribe to Home Assistant command topics (ACL denied)',
      );
      await commandsHass.addContainerSensor({
        name: 'container-name',
        watcher: 'watcher-name',
        displayIcon: 'mdi:docker',
      });
      const discoveryCall = capableClient.publish.mock.calls.find(([topic]) =>
        topic.startsWith('homeassistant/update/'),
      );
      const discoveryPayload = JSON.parse(discoveryCall[1]);
      expect(discoveryPayload).not.toHaveProperty('command_topic');
      expect(discoveryPayload).not.toHaveProperty('payload_install');
      expect(discoveryPayload).not.toHaveProperty('qos');
      expect(discoveryPayload).not.toHaveProperty('retain');
    });

    test('hass.commands true but initCommandSubscription was never called: discovery payload omits command_topic', async () => {
      // Proves the gate is on real subscription state (commandSubscriptionActive),
      // not merely the config flag: a fresh Hass never had initCommandSubscription
      // invoked, so commandSubscriptionActive is still its initial false.
      const capableClient = makeCapableClientMock();
      const commandsHass = new Hass({
        client: capableClient,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await commandsHass.addContainerSensor({
        name: 'container-name',
        watcher: 'watcher-name',
        displayIcon: 'mdi:docker',
      });
      const discoveryCall = capableClient.publish.mock.calls.find(([topic]) =>
        topic.startsWith('homeassistant/update/'),
      );
      const discoveryPayload = JSON.parse(discoveryCall[1]);
      expect(discoveryPayload).not.toHaveProperty('command_topic');
      expect(discoveryPayload).not.toHaveProperty('payload_install');
      expect(discoveryPayload).not.toHaveProperty('qos');
      expect(discoveryPayload).not.toHaveProperty('retain');
      expect(capableClient.subscribeAsync).not.toHaveBeenCalled();
    });

    test('after deregister following a successful subscription: discovery payload omits command_topic', async () => {
      // Covers the commandSubscriptionActive = false assignment in deregister():
      // a subscription that was live goes dead again once deregistered.
      const capableClient = makeCapableClientMock();
      const commandsHass = new Hass({
        client: capableClient,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await commandsHass.initCommandSubscription();
      await commandsHass.deregister();
      await commandsHass.addContainerSensor({
        name: 'container-name',
        watcher: 'watcher-name',
        displayIcon: 'mdi:docker',
      });
      const discoveryCall = capableClient.publish.mock.calls.find(([topic]) =>
        topic.startsWith('homeassistant/update/'),
      );
      const discoveryPayload = JSON.parse(discoveryCall[1]);
      expect(discoveryPayload).not.toHaveProperty('command_topic');
      expect(discoveryPayload).not.toHaveProperty('payload_install');
      expect(discoveryPayload).not.toHaveProperty('qos');
      expect(discoveryPayload).not.toHaveProperty('retain');
    });

    test('hass.commands true + discovery false: no discovery publish at all', async () => {
      const commandsNoDiscoveryHass = new Hass({
        client: mqttClientMock,
        configuration: {
          topic: 'topic',
          hass: { discovery: false, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      vi.spyOn(commandsNoDiscoveryHass, 'updateContainerSensors').mockResolvedValue(undefined);
      await commandsNoDiscoveryHass.addContainerSensor({
        name: 'container-name',
        watcher: 'watcher-name',
        displayIcon: 'mdi:docker',
      });
      const discoveryCalls = mqttClientMock.publish.mock.calls.filter(([topic]) =>
        topic.startsWith('homeassistant/'),
      );
      expect(discoveryCalls).toHaveLength(0);
    });

    test('agent-segmented layout: command_topic reflects the 5-segment state topic', async () => {
      const capableClient = makeCapableClientMock();
      const agentCommandsHass = new Hass({
        client: capableClient,
        configuration: {
          topic: 'topic',
          hass: {
            discovery: true,
            prefix: 'homeassistant',
            commands: true,
            agenttopicsegment: true,
          },
        },
        log,
        isContainerAllowed: () => true,
      });
      await agentCommandsHass.initCommandSubscription();
      await agentCommandsHass.addContainerSensor({
        id: 'ctr-1',
        name: 'nginx',
        watcher: 'local',
        agent: 'ml',
        displayIcon: 'mdi:docker',
      });
      const discoveryCall = capableClient.publish.mock.calls.find(([topic]) =>
        topic.startsWith('homeassistant/update/'),
      );
      const discoveryPayload = JSON.parse(discoveryCall[1]);
      expect(discoveryPayload.command_topic).toBe('topic/agent/ml/local/nginx/cmd');
    });
  });

  describe('initCommandSubscription', () => {
    let capableClientMock: ReturnType<typeof makeCapableClientMock>;

    beforeEach(() => {
      capableClientMock = makeCapableClientMock();
    });

    function makeCommandsHass(
      configOverrides: Record<string, unknown> = {},
      client: unknown = capableClientMock,
    ) {
      return new Hass({
        client,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: true, ...configOverrides },
        },
        log,
        isContainerAllowed: () => true,
      });
    }

    test('no-op when hass.commands is false/absent', async () => {
      const h = makeCommandsHass({ commands: false });
      await h.initCommandSubscription();
      expect(capableClientMock.on).not.toHaveBeenCalled();
      expect(capableClientMock.subscribeAsync).not.toHaveBeenCalled();
    });

    test('capable client: subscribes with the two exact filters at qos 1, registers one message listener', async () => {
      const h = makeCommandsHass();
      await h.initCommandSubscription();
      expect(capableClientMock.on).toHaveBeenCalledTimes(1);
      expect(capableClientMock.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(capableClientMock.subscribeAsync).toHaveBeenCalledTimes(1);
      expect(capableClientMock.subscribeAsync).toHaveBeenCalledWith(
        ['topic/+/+/cmd', 'topic/agent/+/+/+/cmd'],
        { qos: 1 },
      );
    });

    test('publish-only client: warns and skips, no subscription surface exists on it', async () => {
      const publishOnlyClient = { publish: vi.fn() };
      const logWarnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      const h = makeCommandsHass({}, publishOnlyClient);
      await h.initCommandSubscription();
      expect(logWarnSpy).toHaveBeenCalledWith(
        'Home Assistant install commands are enabled but the MQTT client does not support subscriptions; skipping.',
      );
      // publishOnlyClient (the client actually passed to Hass) lacks
      // on/subscribeAsync entirely, so no subscription could have been
      // established on it.
      expect(publishOnlyClient.on).toBeUndefined();
      expect(publishOnlyClient.subscribeAsync).toBeUndefined();
    });

    test('subscribeAsync rejection: caught, warned, listener cleaned up, method resolves', async () => {
      capableClientMock.subscribeAsync.mockRejectedValue(new Error('ACL denied'));
      const logWarnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      const h = makeCommandsHass();

      await expect(h.initCommandSubscription()).resolves.toBeUndefined();

      const registeredListener = capableClientMock.on.mock.calls[0][1];
      expect(logWarnSpy).toHaveBeenCalledWith(
        'Failed to subscribe to Home Assistant command topics (ACL denied)',
      );
      expect(capableClientMock.removeListener).toHaveBeenCalledWith('message', registeredListener);
    });

    test('subscribeAsync rejection with a non-Error value still warns using String(error)', async () => {
      capableClientMock.subscribeAsync.mockRejectedValue('acl-denied-string');
      const logWarnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      const h = makeCommandsHass();

      await h.initCommandSubscription();

      expect(logWarnSpy).toHaveBeenCalledWith(
        'Failed to subscribe to Home Assistant command topics (acl-denied-string)',
      );
    });

    test('called twice (re-init) registers a fresh, independent listener each time', async () => {
      const h = makeCommandsHass();
      await h.initCommandSubscription();
      await h.initCommandSubscription();
      expect(capableClientMock.on).toHaveBeenCalledTimes(2);
      expect(capableClientMock.subscribeAsync).toHaveBeenCalledTimes(2);
      const [firstListener] = capableClientMock.on.mock.calls[0];
      const [secondListener] = capableClientMock.on.mock.calls[1];
      expect(firstListener).toBe('message');
      expect(secondListener).toBe('message');
      expect(capableClientMock.on.mock.calls[0][1]).not.toBe(capableClientMock.on.mock.calls[1][1]);
    });

    test('subscribeAsync rejection where client capability degrades between checks skips the removeListener cleanup call', async () => {
      // hasHassCommandCapableClient() is a runtime duck-type check re-evaluated
      // on every call rather than cached, so the catch block's cleanup guard
      // (`this.commandMessageHandler && hasHassCommandCapableClient(this.client)`)
      // re-checks capability independently of the entry guard on line 341. A
      // client whose capability degenerates *between* those two checks (e.g. a
      // transport that tears down its subscribe/unsubscribe surface mid-call)
      // must skip the removeListener cleanup rather than throw.
      let unsubscribeAsyncAccessCount = 0;
      const degradingClient = {
        publish: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
        subscribeAsync: vi.fn().mockRejectedValue(new Error('boom')),
      } as unknown as {
        publish: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
        removeListener: ReturnType<typeof vi.fn>;
        subscribeAsync: ReturnType<typeof vi.fn>;
        unsubscribeAsync?: () => Promise<unknown>;
      };
      Object.defineProperty(degradingClient, 'unsubscribeAsync', {
        configurable: true,
        get() {
          unsubscribeAsyncAccessCount += 1;
          // Capable on the entry guard's check, incapable by the time the
          // catch block re-checks.
          return unsubscribeAsyncAccessCount === 1 ? vi.fn() : undefined;
        },
      });

      const h = makeCommandsHass({}, degradingClient);
      await h.initCommandSubscription();

      expect(degradingClient.removeListener).not.toHaveBeenCalled();
    });
  });

  describe('inbound command message handling', () => {
    const baseTopic = 'topic';
    let commandClientMock: ReturnType<typeof makeCapableClientMock>;
    let commandsHass: Hass;

    beforeEach(async () => {
      commandClientMock = makeCapableClientMock();
      commandsHass = new Hass({
        client: commandClientMock,
        configuration: {
          topic: baseTopic,
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await commandsHass.initCommandSubscription();
      // Default spy with no implementation — negative-assertion tests never
      // reach the call at all (guard clauses return earlier), while
      // positive-path tests override with their own mockResolvedValue/
      // mockRejectedValue below.
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate');
    });

    function seedContainer(overrides: Record<string, unknown> = {}) {
      const container = { id: 'ctr-1', name: 'nginx', watcher: 'local', ...overrides };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([container] as any);
      return container;
    }

    function commandTopicFor(container: { name: string; watcher: string; agent?: string }) {
      return getHassCommandTopicFromStateTopic(commandsHass.getContainerStateTopic({ container }));
    }

    // ── Retained-message guard ────────────────────────────────────────────

    test('retained message is ignored: no update call, no audit, debug log only', async () => {
      const container = seedContainer();
      const debugSpy = vi.spyOn(log, 'debug').mockImplementation(() => {});
      await fireCommandMessage(commandClientMock, commandTopicFor(container), 'install', {
        retain: true,
      });
      expect(requestUpdateModule.requestContainerUpdate).not.toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring retained hass command message'),
      );
    });

    test('non-retained message proceeds to resolution (baseline happy path)', async () => {
      const container = seedContainer();
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-baseline',
      } as any);
      await fireCommandMessage(commandClientMock, commandTopicFor(container), 'install', {
        retain: false,
      });
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledWith(container);
    });

    // ── Topic/payload guards ──────────────────────────────────────────────

    test('topic not ending in /cmd is dropped', async () => {
      seedContainer();
      await fireCommandMessage(commandClientMock, 'topic/local/nginx', 'install', {
        retain: false,
      });
      expect(requestUpdateModule.requestContainerUpdate).not.toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    });

    test('topic not under the base topic is dropped', async () => {
      seedContainer();
      await fireCommandMessage(commandClientMock, 'other/local/nginx/cmd', 'install', {
        retain: false,
      });
      expect(requestUpdateModule.requestContainerUpdate).not.toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    });

    test.each([
      '',
      'ON',
      '{"install":true}',
      'Install',
    ])('unexpected payload %j is dropped independently, debug-logged, no call', async (payload) => {
      const container = seedContainer();
      const debugSpy = vi.spyOn(log, 'debug').mockImplementation(() => {});
      await fireCommandMessage(commandClientMock, commandTopicFor(container), payload, {
        retain: false,
      });
      expect(requestUpdateModule.requestContainerUpdate).not.toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('unexpected payload'));
    });

    // ── Reverse lookup (Gotcha B) ─────────────────────────────────────────

    test('default-layout command topic resolves to the exact seeded container object', async () => {
      const container = seedContainer();
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-1',
      } as any);
      await fireCommandMessage(commandClientMock, commandTopicFor(container), 'install', {
        retain: false,
      });
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledWith(container);
    });

    test('agent-segmented command topic resolves to the correct agent-scoped container', async () => {
      const agentClientMock = makeCapableClientMock();
      const agentHass = new Hass({
        client: agentClientMock,
        configuration: {
          topic: baseTopic,
          hass: {
            discovery: true,
            prefix: 'homeassistant',
            commands: true,
            agenttopicsegment: true,
          },
        },
        log,
        isContainerAllowed: () => true,
      });
      await agentHass.initCommandSubscription();
      const container = { id: 'ctr-agent-1', name: 'nginx', watcher: 'local', agent: 'ml' };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([container] as any);
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-agent',
      } as any);
      const commandTopic = getHassCommandTopicFromStateTopic(
        agentHass.getContainerStateTopic({ container }),
      );
      await fireCommandMessage(agentClientMock, commandTopic, 'install', { retain: false });
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledWith(container);
    });

    test('no matching container: not-found, dropped, debug log, no audit event', async () => {
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([]);
      const debugSpy = vi.spyOn(log, 'debug').mockImplementation(() => {});
      await fireCommandMessage(commandClientMock, `${baseTopic}/local/ghost/cmd`, 'install', {
        retain: false,
      });
      expect(requestUpdateModule.requestContainerUpdate).not.toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('No tracked container'));
    });

    test('two containers colliding on the same state topic: ambiguous, dropped, warn log, no call, no audit', async () => {
      const containerA = { id: 'ctr-a', name: 'nginx', watcher: 'local' };
      const containerB = { id: 'ctr-b', name: 'nginx', watcher: 'local' };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([containerA, containerB] as any);
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      await fireCommandMessage(commandClientMock, `${baseTopic}/local/nginx/cmd`, 'install', {
        retain: false,
      });
      expect(requestUpdateModule.requestContainerUpdate).not.toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Ambiguous hass command topic'));
    });

    test('resolves via a live store scan with zero container-added/updated events ever fired (no cache dependency)', async () => {
      const freshClientMock = makeCapableClientMock();
      const freshHass = new Hass({
        client: freshClientMock,
        configuration: {
          topic: baseTopic,
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await freshHass.initCommandSubscription();

      // No addContainerSensor/removeContainerSensor call was ever made on
      // freshHass, so the event-driven containerStateTopicById cache is
      // guaranteed empty — proves resolution does not depend on it.
      const internalMap = (freshHass as unknown as { containerStateTopicById: Map<string, string> })
        .containerStateTopicById;
      expect(internalMap.size).toBe(0);

      const container = { id: 'ctr-cold', name: 'nginx', watcher: 'local' };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([container] as any);
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-cold',
      } as any);

      const commandTopic = getHassCommandTopicFromStateTopic(
        freshHass.getContainerStateTopic({ container }),
      );
      await fireCommandMessage(freshClientMock, commandTopic, 'install', { retain: false });

      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledWith(container);
      expect(internalMap.size).toBe(0);
    });

    test('container removed from the store before the command arrives resolves as not-found', async () => {
      const container = { id: 'ctr-gone', name: 'nginx', watcher: 'local' };
      const commandTopic = commandTopicFor(container);
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([]); // removed by the time the command arrives
      const debugSpy = vi.spyOn(log, 'debug').mockImplementation(() => {});
      await fireCommandMessage(commandClientMock, commandTopic, 'install', { retain: false });
      expect(requestUpdateModule.requestContainerUpdate).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('No tracked container'));
    });

    test('container without an id: rate-limit key falls back to the state topic', async () => {
      const container = seedContainer({ id: undefined });
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-noid',
      } as any);
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      const commandTopic = commandTopicFor(container);

      await fireCommandMessage(commandClientMock, commandTopic, 'install', { retain: false });
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledTimes(1);

      // Firing again immediately proves the fallback key (derived from
      // stateTopic, since getContainerId() returns undefined) is stable
      // across calls and is what the rate limiter is keying on.
      await fireCommandMessage(commandClientMock, commandTopic, 'install', { retain: false });
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
    });

    test('an exception thrown outside the inner try/catch (e.g. containerStore.getContainers throwing) is caught by the outer safety net and warn-logged', async () => {
      vi.spyOn(containerStore, 'getContainers').mockImplementation(() => {
        throw new Error('store unavailable');
      });
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

      await fireCommandMessage(commandClientMock, `${baseTopic}/local/nginx/cmd`, 'install', {
        retain: false,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error handling hass command message on'),
      );
    });

    // ── requestContainerUpdate outcomes / audit ─────────────────────────────

    test('success: records a success audit event with the operation id, info-logs', async () => {
      const container = seedContainer();
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-happy',
      } as any);
      const infoSpy = vi.spyOn(log, 'info').mockImplementation(() => {});
      await fireCommandMessage(commandClientMock, commandTopicFor(container), 'install', {
        retain: false,
      });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith({
        action: 'mqtt-command-update',
        container,
        status: 'success',
        details: 'operation op-happy',
      });
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Accepted hass install command'),
      );
    });

    test('UpdateRequestError 400 (no update available): swallowed, info-logged, audited as error', async () => {
      const container = seedContainer();
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockRejectedValue(
        new UpdateRequestError(400, 'No update available for this container'),
      );
      const infoSpy = vi.spyOn(log, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      await expect(
        fireCommandMessage(commandClientMock, commandTopicFor(container), 'install', {
          retain: false,
        }),
      ).resolves.toBeUndefined();
      expect(mockRecordAuditEvent).toHaveBeenCalledWith({
        action: 'mqtt-command-update',
        container,
        status: 'error',
        details: 'No update available for this container',
      });
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Hass install command rejected'),
      );
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Unexpected error'));
    });

    test('UpdateRequestError 409 (active operation): swallowed, audited as error', async () => {
      const container = seedContainer();
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockRejectedValue(
        new UpdateRequestError(409, 'Container update already in progress'),
      );
      await fireCommandMessage(commandClientMock, commandTopicFor(container), 'install', {
        retain: false,
      });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith({
        action: 'mqtt-command-update',
        container,
        status: 'error',
        details: 'Container update already in progress',
      });
    });

    test('UpdateRequestError 404 (no docker trigger found): swallowed, audited as error', async () => {
      const container = seedContainer();
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockRejectedValue(
        new UpdateRequestError(404, 'No docker trigger found for this container'),
      );
      await fireCommandMessage(commandClientMock, commandTopicFor(container), 'install', {
        retain: false,
      });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith({
        action: 'mqtt-command-update',
        container,
        status: 'error',
        details: 'No docker trigger found for this container',
      });
    });

    test('unexpected non-UpdateRequestError: warn-logged, audited generically, does not throw', async () => {
      const container = seedContainer();
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockRejectedValue(new Error('boom'));
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      await expect(
        fireCommandMessage(commandClientMock, commandTopicFor(container), 'install', {
          retain: false,
        }),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Unexpected error handling hass install command for container [nginx] (boom)',
        ),
      );
      expect(mockRecordAuditEvent).toHaveBeenCalledWith({
        action: 'mqtt-command-update',
        container,
        status: 'error',
        details: 'Unexpected error',
      });
    });

    test('unexpected non-Error thrown value still warn-logs (String(error) fallback) and audits generically', async () => {
      const container = seedContainer();
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockRejectedValue(
        'raw-string-rejection',
      );
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
      await fireCommandMessage(commandClientMock, commandTopicFor(container), 'install', {
        retain: false,
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Unexpected error handling hass install command for container [nginx] (raw-string-rejection)',
        ),
      );
      expect(mockRecordAuditEvent).toHaveBeenCalledWith({
        action: 'mqtt-command-update',
        container,
        status: 'error',
        details: 'Unexpected error',
      });
    });

    // ── Cross-agent routing ─────────────────────────────────────────────────

    test('resolved container carries agent field intact into requestContainerUpdate', async () => {
      const agentClientMock = makeCapableClientMock();
      const agentHass = new Hass({
        client: agentClientMock,
        configuration: {
          topic: baseTopic,
          hass: {
            discovery: true,
            prefix: 'homeassistant',
            commands: true,
            agenttopicsegment: true,
          },
        },
        log,
        isContainerAllowed: () => true,
      });
      await agentHass.initCommandSubscription();
      const container = {
        id: 'ctr-agent-routing',
        name: 'nginx',
        watcher: 'local',
        agent: 'agent-1',
      };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([container] as any);
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-agent-routing',
      } as any);
      const commandTopic = getHassCommandTopicFromStateTopic(
        agentHass.getContainerStateTopic({ container }),
      );
      await fireCommandMessage(agentClientMock, commandTopic, 'install', { retain: false });
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'agent-1' }),
      );
    });

    test('agenttopicsegment=true globally with a no-agent container still resolves via the agentless filter', async () => {
      const agentClientMock = makeCapableClientMock();
      const agentHass = new Hass({
        client: agentClientMock,
        configuration: {
          topic: baseTopic,
          hass: {
            discovery: true,
            prefix: 'homeassistant',
            commands: true,
            agenttopicsegment: true,
          },
        },
        log,
        isContainerAllowed: () => true,
      });
      await agentHass.initCommandSubscription();
      const container = { id: 'ctr-noagent', name: 'nginx', watcher: 'local', agent: undefined };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([container] as any);
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-noagent',
      } as any);
      const commandTopic = getHassCommandTopicFromStateTopic(
        agentHass.getContainerStateTopic({ container }),
      );
      await fireCommandMessage(agentClientMock, commandTopic, 'install', { retain: false });
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledWith(container);
    });
  });

  describe('rate limiting', () => {
    let clientMock: ReturnType<typeof makeCapableClientMock>;
    let rlHass: Hass;
    let dateNowSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      clientMock = makeCapableClientMock();
      rlHass = new Hass({
        client: clientMock,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await rlHass.initCommandSubscription();
      dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-rl',
      } as any);
    });

    afterEach(() => {
      dateNowSpy.mockRestore();
    });

    test('immediate second command for the same container is rate-limited; update requested exactly once', async () => {
      const container = { id: 'ctr-rl-1', name: 'nginx', watcher: 'local' };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([container] as any);
      const commandTopic = getHassCommandTopicFromStateTopic(
        rlHass.getContainerStateTopic({ container }),
      );
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

      await fireCommandMessage(clientMock, commandTopic, 'install', { retain: false });
      await fireCommandMessage(clientMock, commandTopic, 'install', { retain: false });

      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
      // Only the first (accepted) command is audited; the rate-limited drop is not.
      expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1);
    });

    test('command after the cooldown elapses is accepted again', async () => {
      const container = { id: 'ctr-rl-2', name: 'nginx', watcher: 'local' };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([container] as any);
      const commandTopic = getHassCommandTopicFromStateTopic(
        rlHass.getContainerStateTopic({ container }),
      );

      await fireCommandMessage(clientMock, commandTopic, 'install', { retain: false });
      dateNowSpy.mockReturnValue(1_000_000 + 30_000);
      await fireCommandMessage(clientMock, commandTopic, 'install', { retain: false });

      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledTimes(2);
    });

    test('two different containers near-simultaneously are both accepted independently', async () => {
      const containerA = { id: 'ctr-rl-a', name: 'nginx', watcher: 'local' };
      const containerB = { id: 'ctr-rl-b', name: 'redis', watcher: 'local' };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([containerA, containerB] as any);
      const topicA = getHassCommandTopicFromStateTopic(
        rlHass.getContainerStateTopic({ container: containerA }),
      );
      const topicB = getHassCommandTopicFromStateTopic(
        rlHass.getContainerStateTopic({ container: containerB }),
      );

      await fireCommandMessage(clientMock, topicA, 'install', { retain: false });
      await fireCommandMessage(clientMock, topicB, 'install', { retain: false });

      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledTimes(2);
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledWith(containerA);
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledWith(containerB);
    });

    test('synchronous double-fire before the first requestContainerUpdate settles is rejected by the rate limiter itself', async () => {
      const container = { id: 'ctr-rl-sync', name: 'nginx', watcher: 'local' };
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([container] as any);
      const commandTopic = getHassCommandTopicFromStateTopic(
        rlHass.getContainerStateTopic({ container }),
      );

      let resolveUpdate: (value: { operationId: string }) => void;
      const pendingUpdate = new Promise<{ operationId: string }>((resolve) => {
        resolveUpdate = resolve;
      });
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockReturnValue(pendingUpdate as any);

      const listener = getRegisteredMessageListener(clientMock)!;
      // Fire twice synchronously, back-to-back, before the first await settles.
      listener(commandTopic, Buffer.from('install'), { retain: false });
      listener(commandTopic, Buffer.from('install'), { retain: false });

      resolveUpdate!({ operationId: 'op-sync' });
      await flushMicrotasks();

      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('deregister / lifecycle', () => {
    test('deregister unsubscribes exact filters, removes the exact listener, and clears the rate limiter', async () => {
      const clientMock = makeCapableClientMock();
      const h = new Hass({
        client: clientMock,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await h.initCommandSubscription();
      const registeredListener = clientMock.on.mock.calls[0][1];

      const rateLimiter = (
        h as unknown as { commandRateLimiter: { tryConsume: (key: string) => boolean } }
      ).commandRateLimiter;
      expect(rateLimiter.tryConsume('probe-key')).toBe(true);
      expect(rateLimiter.tryConsume('probe-key')).toBe(false); // consumed, still within cooldown

      await h.deregister();

      expect(clientMock.unsubscribeAsync).toHaveBeenCalledWith([
        'topic/+/+/cmd',
        'topic/agent/+/+/+/cmd',
      ]);
      expect(clientMock.removeListener).toHaveBeenCalledWith('message', registeredListener);
      expect(rateLimiter.tryConsume('probe-key')).toBe(true); // cleared by deregister
    });

    test('deregister is a no-op for command cleanup when commands were never enabled', async () => {
      const clientMock = makeCapableClientMock();
      const h = new Hass({
        client: clientMock,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: false },
        },
        log,
        isContainerAllowed: () => true,
      });
      await h.initCommandSubscription(); // no-op since commands:false

      await expect(h.deregister()).resolves.toBeUndefined();

      expect(clientMock.unsubscribeAsync).not.toHaveBeenCalled();
      expect(clientMock.removeListener).not.toHaveBeenCalled();
    });

    test('deregister catches unsubscribeAsync rejection, warns, and still resolves', async () => {
      const clientMock = makeCapableClientMock();
      clientMock.unsubscribeAsync.mockRejectedValue(new Error('broker gone'));
      const h = new Hass({
        client: clientMock,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await h.initCommandSubscription();
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

      await expect(h.deregister()).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to unsubscribe hass command topics (broker gone)',
      );
    });

    test('deregister handles a non-Error unsubscribeAsync rejection (String(error) fallback)', async () => {
      const clientMock = makeCapableClientMock();
      clientMock.unsubscribeAsync.mockRejectedValue('raw-reason');
      const h = new Hass({
        client: clientMock,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant', commands: true },
        },
        log,
        isContainerAllowed: () => true,
      });
      await h.initCommandSubscription();
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

      await h.deregister();

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to unsubscribe hass command topics (raw-reason)',
      );
    });

    test('full re-init cycle leaves exactly one active listener with no stacking', async () => {
      const clientMock = makeCapableClientMock();
      const config = {
        topic: 'topic',
        hass: { discovery: true, prefix: 'homeassistant', commands: true },
      };

      const first = new Hass({
        client: clientMock,
        configuration: config,
        log,
        isContainerAllowed: () => true,
      });
      await first.initCommandSubscription();
      await first.deregister();

      const second = new Hass({
        client: clientMock,
        configuration: config,
        log,
        isContainerAllowed: () => true,
      });
      await second.initCommandSubscription();

      // 2 registrations total across both instances' lifetimes, 1 removal (from first's deregister).
      expect(clientMock.on).toHaveBeenCalledTimes(2);
      expect(clientMock.removeListener).toHaveBeenCalledTimes(1);
      const firstListener = clientMock.on.mock.calls[0][1];
      const secondListener = clientMock.on.mock.calls[1][1];
      expect(firstListener).not.toBe(secondListener);
      expect(clientMock.removeListener).toHaveBeenCalledWith('message', firstListener);
    });

    test('existing containerStateTopicById.clear() assertion in deregister() still passes unmodified (regression)', async () => {
      const clientMock = makeCapableClientMock();
      const h = new Hass({
        client: clientMock,
        configuration: {
          topic: 'topic',
          hass: { discovery: true, prefix: 'homeassistant' },
        },
        log,
        isContainerAllowed: () => true,
      });
      await h.addContainerSensor({
        id: 'container-regression',
        name: 'container-name',
        watcher: 'watcher-name',
        displayIcon: 'mdi:docker',
      });
      const internalMap = (h as unknown as { containerStateTopicById: Map<string, string> })
        .containerStateTopicById;
      expect(internalMap.size).toBe(1);

      await h.deregister();

      expect(internalMap.size).toBe(0);
    });
  });
});
