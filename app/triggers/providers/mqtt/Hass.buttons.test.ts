import log from '../../../log/index.js';
import * as registry from '../../../registry/index.js';
import * as containerStore from '../../../store/container.js';
import * as requestUpdateModule from '../../../updates/request-update.js';
import { UpdateRequestError } from '../../../updates/request-update.js';
import Hass from './Hass.js';

vi.mock('../../../event/index.js', () => ({
  registerContainerAdded: vi.fn(),
  registerContainerUpdated: vi.fn(),
  registerContainerRemoved: vi.fn(),
  registerWatcherStart: vi.fn(),
  registerWatcherStop: vi.fn(),
}));

const { mockRecordAuditEvent } = vi.hoisted(() => ({ mockRecordAuditEvent: vi.fn() }));
vi.mock('../../../api/audit-events.js', () => ({ recordAuditEvent: mockRecordAuditEvent }));

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeClient() {
  return {
    publish: vi.fn(() => {}),
    subscribeAsync: vi.fn().mockResolvedValue(undefined),
    unsubscribeAsync: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}

function makeHass({
  client = makeClient() as any,
  hass = {},
  isContainerAllowed = () => true,
}: {
  client?: any;
  hass?: Record<string, unknown>;
  isContainerAllowed?: () => boolean;
} = {}) {
  return new Hass({
    client,
    configuration: {
      topic: 'topic',
      hass: {
        discovery: true,
        prefix: 'homeassistant',
        buttons: true,
        devicepercontainer: true,
        ...hass,
      },
    },
    log,
    isContainerAllowed,
  });
}

function discoveryPayloads(client: { publish: ReturnType<typeof vi.fn> }, prefix: string) {
  return client.publish.mock.calls
    .filter(([topic]) => (topic as string).startsWith(prefix))
    .map(([topic, payload]) => ({ topic, payload: payload ? JSON.parse(payload as string) : '' }));
}

const container = {
  id: 'ctr-1',
  name: 'nginx',
  displayName: 'Nginx',
  watcher: 'local',
  image: { name: 'library/nginx' },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('update entity release info and availability', () => {
  test('publishes release_summary from the release notes and prefers the link for release_url', async () => {
    const client = makeClient();
    const hass = makeHass({ client, hass: { buttons: false } });
    await hass.addContainerSensor({
      ...container,
      result: {
        link: 'https://example.com/link',
        releaseNotes: {
          title: 'v2.0.0',
          body: 'Fixes\n\n  things',
          url: 'https://example.com/notes',
        },
      },
    });
    const [{ payload }] = discoveryPayloads(client, 'homeassistant/update/');
    expect(payload.release_summary).toBe('v2.0.0: Fixes things');
    expect(payload.release_url).toBe('https://example.com/link');
    expect(payload.availability_topic).toBe('topic/status');
    expect(payload.payload_available).toBe('online');
    expect(payload.payload_not_available).toBe('offline');
  });

  test('falls back to the release notes url and truncates the summary to 255 characters', async () => {
    const client = makeClient();
    const hass = makeHass({ client, hass: { buttons: false } });
    await hass.addContainerSensor({
      ...container,
      result: {
        releaseNotes: { title: 'v2', body: 'x'.repeat(400), url: 'https://example.com/notes' },
      },
    });
    const [{ payload }] = discoveryPayloads(client, 'homeassistant/update/');
    expect(Array.from(payload.release_summary)).toHaveLength(255);
    expect(payload.release_summary.endsWith('…')).toBe(true);
    expect(payload.release_url).toBe('https://example.com/notes');
  });

  test('omits release_summary and release_url when no release info is known', async () => {
    const client = makeClient();
    const hass = makeHass({ client, hass: { buttons: false } });
    await hass.addContainerSensor({ ...container });
    const [{ payload }] = discoveryPayloads(client, 'homeassistant/update/');
    expect(payload).not.toHaveProperty('release_summary');
    expect(payload).not.toHaveProperty('release_url');
  });
});

describe('button discovery', () => {
  test('buttons off: no button entities and no button subscription', async () => {
    const client = makeClient();
    const hass = makeHass({ client, hass: { buttons: false, commands: true } });
    await hass.initCommandSubscription();
    await hass.addContainerSensor(container);
    expect(discoveryPayloads(client, 'homeassistant/button/')).toEqual([]);
    expect(client.subscribeAsync).toHaveBeenCalledWith(['topic/+/+/cmd', 'topic/agent/+/+/+/cmd'], {
      qos: 1,
    });
  });

  test('buttons on but no live subscription: nothing advertised', async () => {
    const client = makeClient();
    client.subscribeAsync.mockRejectedValue(new Error('ACL denied'));
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    const hass = makeHass({ client });
    await hass.initCommandSubscription();
    await hass.addContainerSensor(container);
    expect(discoveryPayloads(client, 'homeassistant/button/')).toEqual([]);
  });

  test('buttons on: subscribes to the button filters and publishes both button entities', async () => {
    const client = makeClient();
    const hass = makeHass({ client });
    await hass.initCommandSubscription();
    expect(client.subscribeAsync).toHaveBeenCalledWith(
      ['topic/+/+/cmd/+', 'topic/agent/+/+/+/cmd/+'],
      { qos: 1 },
    );
    await hass.addContainerSensor(container);
    const buttons = discoveryPayloads(client, 'homeassistant/button/');
    expect(buttons.map((b) => b.topic)).toEqual([
      'homeassistant/button/topic_local_nginx_check/config',
      'homeassistant/button/topic_local_nginx_update/config',
    ]);
    const [check, update] = buttons.map((b) => b.payload);
    expect(check).toMatchObject({
      name: 'Check for updates',
      command_topic: 'topic/local/nginx/cmd/check',
      payload_press: 'PRESS',
      qos: 1,
      retain: false,
      json_attributes_topic: 'topic/local/nginx/cmd/check/result',
      availability_topic: 'topic/status',
      icon: 'mdi:refresh',
    });
    expect(check).not.toHaveProperty('state_topic');
    expect(check).not.toHaveProperty('entity_picture');
    expect(check).not.toHaveProperty('device_class');
    expect(update).toMatchObject({
      name: 'Update now',
      command_topic: 'topic/local/nginx/cmd/update',
      device_class: 'update',
      json_attributes_topic: 'topic/local/nginx/cmd/update/result',
    });
    expect(check.unique_id).not.toBe(update.unique_id);
    expect(check.unique_id).toMatch(/^dd_[0-9a-f]{12}_check$/);
    expect(check.device.via_device).toBe('drydock');
  });

  test('without a per-container device the button names carry the container name', async () => {
    const client = makeClient();
    const hass = makeHass({ client, hass: { devicepercontainer: false } });
    await hass.initCommandSubscription();
    await hass.addContainerSensor(container);
    const names = discoveryPayloads(client, 'homeassistant/button/').map((b) => b.payload.name);
    expect(names).toEqual(['Nginx check for updates', 'Nginx update now']);
  });

  test('clears stale alias button configs on a re-publish', async () => {
    const client = makeClient();
    const hass = makeHass({ client });
    await hass.initCommandSubscription();
    vi.spyOn(hass as any, 'getStaleContainerStateTopics').mockReturnValue(['topic/local/old']);
    await hass.addContainerSensor(container);
    const cleared = client.publish.mock.calls.filter(
      ([topic, payload]) => (topic as string).startsWith('homeassistant/button/') && payload === '',
    );
    expect(cleared.map(([topic]) => topic)).toEqual([
      'homeassistant/button/topic_local_old_check/config',
      'homeassistant/button/topic_local_old_update/config',
    ]);
  });

  test('removing a container clears its button configs', async () => {
    const client = makeClient();
    const hass = makeHass({ client });
    await hass.initCommandSubscription();
    vi.spyOn(containerStore, 'getContainers').mockReturnValue([] as any);
    await hass.removeContainerSensor(container);
    const cleared = client.publish.mock.calls
      .filter(([topic]) => (topic as string).startsWith('homeassistant/button/'))
      .map(([topic, payload]) => [topic, payload]);
    expect(cleared).toEqual([
      ['homeassistant/button/topic_local_nginx_check/config', ''],
      ['homeassistant/button/topic_local_nginx_update/config', ''],
    ]);
  });
});

describe('button command handling', () => {
  let client: ReturnType<typeof makeClient>;

  async function setup(options: Parameters<typeof makeHass>[0] = {}) {
    client = makeClient();
    const hass = makeHass({ client, ...options });
    await hass.initCommandSubscription();
    return hass;
  }

  function seed(overrides: Record<string, unknown> = {}) {
    const seeded = { ...container, ...overrides };
    vi.spyOn(containerStore, 'getContainers').mockReturnValue([seeded] as any);
    return seeded;
  }

  async function press(topic: string, payload = 'PRESS', retain = false) {
    const listener = client.on.mock.calls.find(([event]) => event === 'message')?.[1];
    listener(topic, Buffer.from(payload), { retain });
    await flush();
  }

  function resultFor(action: string) {
    const call = client.publish.mock.calls
      .filter(([topic]) => topic === `topic/local/nginx/cmd/${action}/result`)
      .at(-1);
    return call ? { ...JSON.parse(call[1] as string), options: call[2] } : undefined;
  }

  describe('update now', () => {
    test('accepted: requests the manual update, audits, publishes the operation id', async () => {
      await setup();
      const seeded = seed();
      const request = vi
        .spyOn(requestUpdateModule, 'requestContainerUpdate')
        .mockResolvedValue({ operationId: 'op-1' } as any);
      await press('topic/local/nginx/cmd/update');
      expect(request).toHaveBeenCalledWith(seeded);
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'mqtt-command-update', status: 'success' }),
      );
      expect(resultFor('update')).toMatchObject({
        status: 'accepted',
        operation_id: 'op-1',
        options: { retain: true },
      });
    });

    test('refused by the update policy: publishes the reason', async () => {
      await setup();
      seed();
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockRejectedValue(
        new UpdateRequestError(409, 'Update requires approval'),
      );
      await press('topic/local/nginx/cmd/update');
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', details: 'Update requires approval' }),
      );
      expect(resultFor('update')).toMatchObject({
        status: 'refused',
        reason: 'Update requires approval',
      });
    });

    test('unexpected error: generic reason, no leak', async () => {
      await setup();
      seed();
      vi.spyOn(log, 'warn').mockImplementation(() => {});
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockRejectedValue(
        new Error('secret detail'),
      );
      await press('topic/local/nginx/cmd/update');
      expect(resultFor('update')).toMatchObject({ status: 'error', reason: 'Unexpected error' });
    });

    test('a container without an id is rate limited by its state topic', async () => {
      await setup();
      seed({ id: undefined });
      vi.spyOn(log, 'warn').mockImplementation(() => {});
      const request = vi
        .spyOn(requestUpdateModule, 'requestContainerUpdate')
        .mockResolvedValue({ operationId: 'op-1' } as any);
      await press('topic/local/nginx/cmd/update');
      await press('topic/local/nginx/cmd/update');
      expect(request).toHaveBeenCalledTimes(1);
    });

    test('shares the install command rate limit, second press is refused', async () => {
      await setup();
      seed();
      vi.spyOn(log, 'warn').mockImplementation(() => {});
      const request = vi
        .spyOn(requestUpdateModule, 'requestContainerUpdate')
        .mockResolvedValue({ operationId: 'op-1' } as any);
      await press('topic/local/nginx/cmd/update');
      await press('topic/local/nginx/cmd/update');
      expect(request).toHaveBeenCalledTimes(1);
      expect(resultFor('update')).toMatchObject({ status: 'refused' });
    });
  });

  describe('guards', () => {
    test('retained messages are ignored', async () => {
      await setup();
      seed();
      const request = vi.spyOn(requestUpdateModule, 'requestContainerUpdate');
      await press('topic/local/nginx/cmd/update', 'PRESS', true);
      expect(request).not.toHaveBeenCalled();
      expect(client.publish).not.toHaveBeenCalled();
    });

    test('a payload other than PRESS is ignored', async () => {
      await setup();
      seed();
      const request = vi.spyOn(requestUpdateModule, 'requestContainerUpdate');
      await press('topic/local/nginx/cmd/update', 'install');
      expect(request).not.toHaveBeenCalled();
      expect(client.publish).not.toHaveBeenCalled();
    });

    test('an unknown container is dropped without a result', async () => {
      await setup();
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([] as any);
      await press('topic/local/nginx/cmd/update');
      expect(client.publish).not.toHaveBeenCalled();
    });

    test('an ambiguous topic is refused', async () => {
      await setup();
      vi.spyOn(log, 'warn').mockImplementation(() => {});
      vi.spyOn(containerStore, 'getContainers').mockReturnValue([
        { ...container, id: 'a' },
        { ...container, id: 'b' },
      ] as any);
      const request = vi.spyOn(requestUpdateModule, 'requestContainerUpdate');
      await press('topic/local/nginx/cmd/update');
      expect(request).not.toHaveBeenCalled();
      expect(resultFor('update')).toMatchObject({
        status: 'refused',
        reason: 'Button topic matches more than one container',
      });
    });

    test('an excluded container is refused', async () => {
      await setup({ isContainerAllowed: () => false });
      seed();
      vi.spyOn(log, 'warn').mockImplementation(() => {});
      const request = vi.spyOn(requestUpdateModule, 'requestContainerUpdate');
      await press('topic/local/nginx/cmd/update');
      expect(request).not.toHaveBeenCalled();
      expect(resultFor('update')).toMatchObject({
        status: 'refused',
        reason: 'Container is excluded from this trigger',
      });
    });

    test('a failing result publish is logged and swallowed', async () => {
      await setup();
      seed();
      const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-1',
      } as any);
      client.publish.mockRejectedValue(new Error('broker down'));
      await press('topic/local/nginx/cmd/update');
      expect(warn).toHaveBeenCalledWith('Failed to publish hass button result (broker down)');
    });

    test('button topics are ignored when hass.buttons is off', async () => {
      client = makeClient();
      const hass = makeHass({ client, hass: { buttons: false, commands: true } });
      await hass.initCommandSubscription();
      seed();
      const request = vi.spyOn(requestUpdateModule, 'requestContainerUpdate');
      await press('topic/local/nginx/cmd/update');
      expect(request).not.toHaveBeenCalled();
    });

    test('the install topic is ignored when only buttons are on', async () => {
      await setup();
      seed();
      const request = vi.spyOn(requestUpdateModule, 'requestContainerUpdate');
      await press('topic/local/nginx/cmd', 'install');
      expect(request).not.toHaveBeenCalled();
    });

    test('install and buttons coexist on one subscription', async () => {
      await setup({ hass: { commands: true } });
      seed();
      const request = vi
        .spyOn(requestUpdateModule, 'requestContainerUpdate')
        .mockResolvedValue({ operationId: 'op-2' } as any);
      expect(client.subscribeAsync).toHaveBeenCalledTimes(1);
      await press('topic/local/nginx/cmd', 'install');
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  describe('check for updates', () => {
    function mockWatcher(watcher: unknown, id = 'docker.local') {
      vi.spyOn(registry, 'getState').mockReturnValue({ watcher: { [id]: watcher } } as any);
    }

    test('refreshes the container list, runs the check and reports update availability', async () => {
      await setup();
      const seeded = seed();
      const fresh = { ...seeded, refreshed: true };
      const watcher = {
        getContainers: vi.fn().mockResolvedValue([fresh]),
        watchContainer: vi.fn().mockResolvedValue({ container: { updateAvailable: true } }),
      };
      mockWatcher(watcher);
      await press('topic/local/nginx/cmd/check');
      expect(watcher.watchContainer).toHaveBeenCalledWith(fresh, { emitBatchEvent: true });
      expect(resultFor('check')).toMatchObject({ status: 'checked', update_available: true });
    });

    test('uses the agent-scoped watcher id and tolerates a watcher without getContainers', async () => {
      await setup({ hass: { agenttopicsegment: true } });
      const seeded = seed({ agent: 'edge' });
      const watcher = {
        watchContainer: vi.fn().mockResolvedValue({ container: undefined }),
      };
      mockWatcher(watcher, 'edge.docker.local');
      await press('topic/agent/edge/local/nginx/cmd/check');
      expect(watcher.watchContainer).toHaveBeenCalledWith(seeded, { emitBatchEvent: true });
      const call = client.publish.mock.calls.find(
        ([topic]) => topic === 'topic/agent/edge/local/nginx/cmd/check/result',
      );
      expect(JSON.parse(call?.[1] as string)).toMatchObject({
        status: 'checked',
        update_available: false,
      });
    });

    test('no watcher: reports an error', async () => {
      await setup();
      seed();
      mockWatcher(undefined);
      await press('topic/local/nginx/cmd/check');
      expect(resultFor('check')).toMatchObject({
        status: 'error',
        reason: 'No watcher found for this container',
      });
    });

    test('container missing from the refreshed list: reports an error', async () => {
      await setup();
      seed();
      mockWatcher({ getContainers: vi.fn().mockResolvedValue([]), watchContainer: vi.fn() });
      await press('topic/local/nginx/cmd/check');
      expect(resultFor('check')).toMatchObject({ status: 'error', reason: 'Container not found' });
    });

    test('a failing check is reported without leaking the error', async () => {
      await setup();
      seed();
      vi.spyOn(log, 'warn').mockImplementation(() => {});
      mockWatcher({ watchContainer: vi.fn().mockRejectedValue(new Error('registry 500')) });
      await press('topic/local/nginx/cmd/check');
      expect(resultFor('check')).toMatchObject({ status: 'error', reason: 'Update check failed' });
    });

    test('check is rate limited independently of update', async () => {
      await setup();
      seed();
      vi.spyOn(log, 'warn').mockImplementation(() => {});
      const watchContainer = vi.fn().mockResolvedValue({ container: { updateAvailable: false } });
      mockWatcher({ watchContainer });
      vi.spyOn(requestUpdateModule, 'requestContainerUpdate').mockResolvedValue({
        operationId: 'op-1',
      } as any);
      await press('topic/local/nginx/cmd/check');
      await press('topic/local/nginx/cmd/check');
      await press('topic/local/nginx/cmd/update');
      expect(watchContainer).toHaveBeenCalledTimes(1);
      expect(requestUpdateModule.requestContainerUpdate).toHaveBeenCalledTimes(1);
      expect(resultFor('check')).toMatchObject({ status: 'refused' });
    });
  });
});

describe('lifecycle', () => {
  test('deregister removes the message listener and unsubscribes the button filters once', async () => {
    const client = makeClient();
    const hass = makeHass({ client });
    await hass.initCommandSubscription();
    await hass.deregister();
    expect(client.removeListener).toHaveBeenCalledTimes(1);
    expect(client.unsubscribeAsync).toHaveBeenCalledWith([
      'topic/+/+/cmd/+',
      'topic/agent/+/+/+/cmd/+',
    ]);
  });
});
