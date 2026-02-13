// @ts-nocheck

import {
  registerContainerAdded,
  registerContainerRemoved,
  registerContainerUpdated,
  registerWatcherStart,
  registerWatcherStop,
} from '../../../event/index.js';
import log from '../../../log/index.js';
import Hass from './Hass.js';

vi.mock('../../../event/index.js', () => ({
  registerContainerAdded: vi.fn(),
  registerContainerUpdated: vi.fn(),
  registerContainerRemoved: vi.fn(),
  registerWatcherStart: vi.fn(),
  registerWatcherStop: vi.fn(),
}));

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
        sw_version: 'unknown',
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/drydock.png',
      state_topic: 'my/state',
      myOption: true,
    }),
    { retain: true },
  );
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
        sw_version: 'unknown',
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/drydock.png',
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
  expect(mqttClientMock.publish).toHaveBeenCalledWith(data.discoveryTopic, JSON.stringify({}), {
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
        sw_version: 'unknown',
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/drydock.png',
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
        sw_version: 'unknown',
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/drydock.png',
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
        sw_version: 'unknown',
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/drydock.png',
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
        sw_version: 'unknown',
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/drydock.png',
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
        sw_version: 'unknown',
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/drydock.png',
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
        sw_version: 'unknown',
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/drydock.png',
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
    '{}',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    14,
    'homeassistant/sensor/topic_watcher-name_update_count/config',
    '{}',
    { retain: true },
  );
  expect(mqttClientMock.publish).toHaveBeenNthCalledWith(
    15,
    'homeassistant/binary_sensor/topic_watcher-name_update_status/config',
    '{}',
    { retain: true },
  );
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
  expect(mqttClientMock.publish).toHaveBeenCalledWith(data.discoveryTopic, JSON.stringify({}), {
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
        sw_version: 'unknown',
      },
      icon: 'mdi:docker',
      entity_picture:
        'https://raw.githubusercontent.com/CodesWhat/drydock/main/docs/assets/drydock.png',
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
