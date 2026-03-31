import {
  registerContainerAdded,
  registerContainerRemoved,
  registerContainerUpdated,
  registerWatcherStart,
  registerWatcherStop,
} from '../../../event/index.js';
import log from '../../../log/index.js';
import * as containerStore from '../../../store/container.js';
import Hass, { HASS_CONTAINER_STATE_TOPIC_TRACK_LIMIT } from './Hass.js';

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
        '{% if value_json.update_kind_kind == "digest" %}{{ value_json.result_digest[:15] }}{% else %}{{ value_json.result_tag }}{% endif %}',
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
  });

  hassWithUnregisterCallbacks.deregister();

  expect(unregisterContainerAdded).toHaveBeenCalledTimes(1);
  expect(unregisterContainerUpdated).toHaveBeenCalledTimes(1);
  expect(unregisterContainerRemoved).toHaveBeenCalledTimes(1);
  expect(unregisterWatcherStart).toHaveBeenCalledTimes(1);
  expect(unregisterWatcherStop).toHaveBeenCalledTimes(1);
});
