// @ts-nocheck
import joi from 'joi';
import mqttClient from 'mqtt';
import log from '../../../log/index.js';
import { flatten } from '../../../model/container.js';

vi.mock('mqtt');
vi.mock('node:fs/promises', () => ({
    default: {
        readFile: vi.fn().mockResolvedValue(Buffer.from('file-content')),
    },
    readFile: vi.fn().mockResolvedValue(Buffer.from('file-content')),
}));
import Mqtt from './Mqtt.js';
import fs from 'node:fs/promises';

const mqtt = new Mqtt();
mqtt.log = log;

const configurationValid = {
    url: 'mqtt://host:1883',
    topic: 'dd/container',
    clientid: 'wud',
    hass: {
        discovery: false,
        enabled: false,
        prefix: 'homeassistant',
    },
    tls: {
        clientkey: undefined,
        clientcert: undefined,
        cachain: undefined,
        rejectunauthorized: true,
    },
    threshold: 'all',
    mode: 'simple',
    once: true,
    auto: true,
    order: 100,
    simpletitle:
        'New ${container.updateKind.kind} found for container ${container.name}',

    simplebody:
        'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

    batchtitle: '${containers.length} updates available',
    resolvenotifications: false,
};

const containerData = [
    {
        containerName: 'homeassistant',
        data: {
            name: 'homeassistant',
            topic: 'dd/container/local/homeassistant',
        },
    },
    {
        containerName: 'home.assistant',
        data: {
            name: 'home.assistant',
            topic: 'dd/container/local/home-assistant',
        },
    },
];

beforeEach(async () => {
    vi.resetAllMocks();
    mqtt.client = {
        publish: vi.fn(() => {}),
    };
});

test('validateConfiguration should return validated configuration when valid', async () => {
    const validatedConfiguration =
        mqtt.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should apply_default_configuration', async () => {
    const validatedConfiguration = mqtt.validateConfiguration({
        url: configurationValid.url,
        clientid: 'wud',
    });
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
    const configuration = {
        url: 'http://invalid',
    };
    expect(() => {
        mqtt.validateConfiguration(configuration);
    }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
    mqtt.configuration = {
        password: 'password', // NOSONAR - test fixture, not a real credential
        url: 'mqtt://host:1883',
        topic: 'dd/container',
        hass: {
            discovery: false,
            enabled: false,
            prefix: 'homeassistant',
        },
    };
    expect(mqtt.maskConfiguration()).toEqual({
        hass: {
            discovery: false,
            enabled: false,
            prefix: 'homeassistant',
        },
        password: 'p******d',
        topic: 'dd/container',
        url: 'mqtt://host:1883',
    });
});

test('initTrigger should init Mqtt client', async () => {
    mqtt.configuration = {
        ...configurationValid,
        user: 'user',
        password: 'password', // NOSONAR - test fixture, not a real credential
        clientid: 'wud',
        hass: {
            enabled: true,
            discovery: true,
            prefix: 'homeassistant',
        },
    };
    const spy = vi.spyOn(mqttClient, 'connectAsync');
    await mqtt.initTrigger();
    expect(spy).toHaveBeenCalledWith('mqtt://host:1883', {
        clientId: 'wud',
        username: 'user',
        password: 'password', // NOSONAR - test fixture, not a real credential
        rejectUnauthorized: true,
    });
});

test.each(containerData)(
    'trigger should format json message payload as expected',
    async ({ containerName, data }) => {
        mqtt.configuration = {
            topic: 'dd/container',
        };
        const container = {
            id: '31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816',
            name: containerName,
            watcher: 'local',
            includeTags: '^\\d+\\.\\d+.\\d+$',
            image: {
                id: 'sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6',
                registry: {
                    url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
                },
                name: 'test',
                tag: {
                    value: '2021.6.4',
                    semver: true,
                },
                digest: {
                    watch: false,
                    repo: 'sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72',
                },
                architecture: 'amd64',
                os: 'linux',
                created: '2021-06-12T05:33:38.440Z',
            },
            result: {
                tag: '2021.6.5',
            },
        };
        await mqtt.trigger(container);
        expect(mqtt.client.publish).toHaveBeenCalledWith(
            data.topic,
            JSON.stringify(flatten(container)),
            { retain: true },
        );
    },
);

test('initTrigger should read TLS files when configured', async () => {
    // Re-set mock after vi.resetAllMocks() cleared it
    fs.readFile.mockResolvedValue(Buffer.from('file-content'));
    const spy = vi.spyOn(mqttClient, 'connectAsync');

    mqtt.configuration = {
        ...configurationValid,
        clientid: 'wud',
        tls: {
            clientkey: '/path/to/key.pem',
            clientcert: '/path/to/cert.pem',
            cachain: '/path/to/ca.pem',
            rejectunauthorized: false,
        },
        hass: { enabled: false },
    };
    await mqtt.initTrigger();

    expect(fs.readFile).toHaveBeenCalledWith('/path/to/key.pem');
    expect(fs.readFile).toHaveBeenCalledWith('/path/to/cert.pem');
    expect(fs.readFile).toHaveBeenCalledWith('/path/to/ca.pem');
    expect(spy).toHaveBeenCalledWith(
        'mqtt://host:1883',
        expect.objectContaining({
            key: Buffer.from('file-content'),
            cert: Buffer.from('file-content'),
            ca: [Buffer.from('file-content')],
            rejectUnauthorized: false,
        }),
    );
});

test('triggerBatch should throw error', async () => {
    await expect(mqtt.triggerBatch()).rejects.toThrow(
        'This trigger does not support "batch" mode',
    );
});
