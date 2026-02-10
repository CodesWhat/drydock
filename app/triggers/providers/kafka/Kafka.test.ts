// @ts-nocheck
import joi from 'joi';
import { Kafka as KafkaClient } from 'kafkajs';

vi.mock('kafkajs');

import Kafka from './Kafka.js';

const kafka = new Kafka();

const configurationValid = {
    brokers: 'broker1:9000, broker2:9000',
    topic: 'drydock-container',
    clientId: 'drydock',
    ssl: false,
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

beforeEach(async () => {
    vi.resetAllMocks();
});

test('validateConfiguration should return validated configuration when valid', async () => {
    const validatedConfiguration =
        kafka.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should apply_default_configuration', async () => {
    const validatedConfiguration = kafka.validateConfiguration({
        brokers: 'broker1:9000, broker2:9000',
    });
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should validate_optional_authentication', async () => {
    const validatedConfiguration = kafka.validateConfiguration({
        ...configurationValid,
        authentication: {
            user: 'user',
            password: 'password', // NOSONAR - test fixture, not a real credential
        },
    });
    expect(validatedConfiguration).toStrictEqual({
        ...configurationValid,
        authentication: {
            user: 'user',
            password: 'password', // NOSONAR - test fixture, not a real credential
            type: 'PLAIN',
        },
    });
});

test('validateConfiguration should throw error when invalid', async () => {
    const configuration = {
        ssl: 'whynot',
    };
    expect(() => {
        kafka.validateConfiguration(configuration);
    }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
    kafka.configuration = {
        brokers: 'broker1:9000, broker2:9000',
        topic: 'drydock-container',
        clientId: 'drydock',
        ssl: false,
        authentication: {
            type: 'PLAIN',
            user: 'user',
            password: 'password', // NOSONAR - test fixture, not a real credential
        },
    };
    expect(kafka.maskConfiguration()).toEqual({
        brokers: 'broker1:9000, broker2:9000',
        topic: 'drydock-container',
        clientId: 'drydock',
        ssl: false,
        authentication: {
            type: 'PLAIN',
            user: 'user',
            password: 'p******d',
        },
    });
});

test('maskConfiguration should not fail if no auth provided', async () => {
    kafka.configuration = {
        brokers: 'broker1:9000, broker2:9000',
        topic: 'drydock-container',
        clientId: 'drydock',
        ssl: false,
    };
    expect(kafka.maskConfiguration()).toEqual({
        brokers: 'broker1:9000, broker2:9000',
        topic: 'drydock-container',
        clientId: 'drydock',
        ssl: false,
    });
});

test('initTrigger should init kafka client', async () => {
    kafka.configuration = {
        brokers: 'broker1:9000, broker2:9000',
        topic: 'drydock-container',
        clientId: 'drydock',
        ssl: false,
    };
    await kafka.initTrigger();
    expect(KafkaClient).toHaveBeenCalledWith({
        brokers: ['broker1:9000', 'broker2:9000'],
        clientId: 'drydock',
        ssl: false,
    });
});

test('initTrigger should init kafka client with auth when configured', async () => {
    kafka.configuration = {
        brokers: 'broker1:9000, broker2:9000',
        topic: 'drydock-container',
        clientId: 'drydock',
        ssl: false,
        authentication: {
            type: 'PLAIN',
            user: 'user',
            password: 'password', // NOSONAR - test fixture, not a real credential
        },
    };
    await kafka.initTrigger();
    expect(KafkaClient).toHaveBeenCalledWith({
        brokers: ['broker1:9000', 'broker2:9000'],
        clientId: 'drydock',
        ssl: false,
        sasl: {
            mechanism: 'PLAIN',
            password: 'password', // NOSONAR - test fixture, not a real credential
            username: 'user',
        },
    });
});

test('trigger should post message to kafka', async () => {
    const producer = () => ({
        connect: () => ({}),
        send: (params) => params,
    });
    kafka.kafka = {
        producer,
    };
    kafka.configuration = {
        topic: 'topic',
    };
    const container = {
        name: 'container1',
    };
    const result = await kafka.trigger(container);
    expect(result).toStrictEqual({
        messages: [{ value: '{"name":"container1"}' }],
        topic: 'topic',
    });
});

test('triggerBatch should post multiple messages to kafka', async () => {
    const sendMock = vi.fn((params) => params);
    const connectMock = vi.fn();
    const producer = () => ({
        connect: connectMock,
        send: sendMock,
    });
    kafka.kafka = {
        producer,
    };
    kafka.configuration = {
        topic: 'my-topic',
    };
    const containers = [
        { name: 'container1' },
        { name: 'container2' },
    ];
    const result = await kafka.triggerBatch(containers);
    expect(connectMock).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith({
        topic: 'my-topic',
        messages: [
            { value: '{"name":"container1"}' },
            { value: '{"name":"container2"}' },
        ],
    });
    expect(result).toStrictEqual({
        topic: 'my-topic',
        messages: [
            { value: '{"name":"container1"}' },
            { value: '{"name":"container2"}' },
        ],
    });
});
