// @ts-nocheck
import joi from 'joi';
import axios from 'axios';

vi.mock('axios', () => ({
    default: {
        post: vi.fn().mockResolvedValue({ data: { ok: true } }),
    },
}));

import Telegram from './Telegram.js';

const telegram = new Telegram();

const configurationValid = {
    bottoken: 'token', // NOSONAR - test fixture, not a real credential
    chatid: '123456789',
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
    disabletitle: false,
    messageformat: 'Markdown',
};

beforeEach(async () => {
    vi.resetAllMocks();
});

test('validateConfiguration should return validated configuration when valid', async () => {
    const validatedConfiguration =
        telegram.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
    const configuration = {};
    expect(() => {
        telegram.validateConfiguration(configuration);
    }).toThrowError(joi.ValidationError);
});

test('maskConfiguration should mask sensitive data', async () => {
    telegram.configuration = configurationValid;
    expect(telegram.maskConfiguration()).toEqual({
        batchtitle: '${containers.length} updates available',
        bottoken: 't***n',
        chatid: '1*******9',
        mode: 'simple',
        once: true,
        auto: true,
        order: 100,
        simplebody:
            'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

        simpletitle:
            'New ${container.updateKind.kind} found for container ${container.name}',
        threshold: 'all',
        resolvenotifications: false,
        disabletitle: false,
        messageformat: 'Markdown',
    });
});

test('should send message with correct text', async () => {
    telegram.configuration = {
        ...configurationValid,
        simpletitle: 'Test Title',
        simplebody: 'Test Body',
    };
    telegram.sendMessage = vi.fn();
    await telegram.trigger({});
    expect(telegram.sendMessage).toHaveBeenCalledWith(
        '*Test Title*\n\nTest Body',
    );
});

test.each([
    { messageformat: 'Markdown', expected: '*Test Title*\n\nTest Body' },
    { messageformat: 'HTML', expected: '<b>Test Title</b>\n\nTest Body' },
])(
    'should send message with correct text in %s format',
    async ({ messageformat, expected }) => {
        telegram.configuration = {
            ...configurationValid,
            simpletitle: 'Test Title',
            simplebody: 'Test Body',
            messageformat: messageformat,
        };
        telegram.sendMessage = vi.fn();
        await telegram.trigger({});
        expect(telegram.sendMessage).toHaveBeenCalledWith(expected);
    },
);

test('disabletitle should result in no title in message', async () => {
    telegram.configuration = {
        ...configurationValid,
        simpletitle: 'Test Title',
        simplebody: 'Test Body',
        disabletitle: true,
    };

    telegram.sendMessage = vi.fn();
    await telegram.trigger({});

    expect(telegram.sendMessage).toHaveBeenCalledWith('Test Body');
});

test('triggerBatch should send batch notification', async () => {
    telegram.configuration = configurationValid;
    telegram.sendMessage = vi.fn();
    const containers = [
        {
            name: 'container1',
            updateKind: {
                kind: 'tag',
                localValue: '1.0.0',
                remoteValue: '2.0.0',
            },
        },
        {
            name: 'container2',
            updateKind: {
                kind: 'tag',
                localValue: '1.1.0',
                remoteValue: '2.1.0',
            },
        },
    ];
    await telegram.triggerBatch(containers);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
        '*2 updates available*\n\n- Container container1 running with tag 1.0.0 can be updated to tag 2.0.0\n\n- Container container2 running with tag 1.1.0 can be updated to tag 2.1.0\n',
    );
});

test('initTrigger should set apiUrl from bottoken', async () => {
    telegram.configuration = { ...configurationValid };
    await telegram.initTrigger();
    expect(telegram.apiUrl).toBe('https://api.telegram.org/bottoken');
});

test('triggerBatch with disabletitle should send body only', async () => {
    telegram.configuration = {
        ...configurationValid,
        disabletitle: true,
    };
    telegram.sendMessage = vi.fn();
    const containers = [
        {
            name: 'container1',
            updateKind: {
                kind: 'tag',
                localValue: '1.0.0',
                remoteValue: '2.0.0',
            },
        },
    ];
    await telegram.triggerBatch(containers);
    expect(telegram.sendMessage).toHaveBeenCalled();
    const callArg = telegram.sendMessage.mock.calls[0][0];
    // Should not contain bold markers since title is disabled
    expect(callArg).not.toMatch(/^\*/);
});

test('sendMessage should post to telegram API and return data', async () => {
    // Create a fresh Telegram instance to avoid interference from resetAllMocks
    const tg = new Telegram();
    tg.configuration = { ...configurationValid };
    await tg.initTrigger();

    // Set up mock after resetAllMocks has cleared it
    axios.post.mockResolvedValue({ data: { ok: true } });

    const result = await tg.sendMessage('Hello');
    expect(axios.post).toHaveBeenCalledWith(
        'https://api.telegram.org/bottoken/sendMessage',
        {
            chat_id: '123456789',
            text: 'Hello',
            parse_mode: 'MarkdownV2',
        },
    );
    expect(result).toEqual({ ok: true });
});

test('getParseMode should return HTML when messageformat is HTML', () => {
    telegram.configuration = { ...configurationValid, messageformat: 'HTML' };
    expect(telegram.getParseMode()).toBe('HTML');
});

test('getParseMode should return MarkdownV2 when messageformat is Markdown', () => {
    telegram.configuration = { ...configurationValid, messageformat: 'Markdown' };
    expect(telegram.getParseMode()).toBe('MarkdownV2');
});
