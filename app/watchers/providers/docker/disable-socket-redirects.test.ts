import { describe, expect, test, vi } from 'vitest';
import { disableSocketRedirects } from './disable-socket-redirects.js';

describe('disableSocketRedirects', () => {
  test('patches buildRequest to inject maxRedirects:0 for socket connections', () => {
    const receivedOptions: Record<string, unknown>[] = [];
    const original = vi.fn((options: Record<string, unknown>) => {
      receivedOptions.push({ ...options });
    });
    const modem = {
      socketPath: '/var/run/docker.sock',
      buildRequest: original,
    };
    const dockerApi = { modem } as any;

    disableSocketRedirects(dockerApi);

    const options: Record<string, unknown> = { path: '/images/test/json', method: 'GET' };
    modem.buildRequest(options, {}, null, vi.fn());

    expect(options.maxRedirects).toBe(0);
    expect(original).toHaveBeenCalledOnce();
    expect(receivedOptions[0]).toMatchObject({ maxRedirects: 0 });
  });

  test('is a no-op when modem has no socketPath', () => {
    const original = vi.fn();
    const modem = {
      socketPath: undefined as string | undefined,
      buildRequest: original,
    };
    const dockerApi = { modem } as any;

    disableSocketRedirects(dockerApi);

    expect(modem.buildRequest).toBe(original);
  });

  test('is a no-op when socketPath is empty string', () => {
    const original = vi.fn();
    const modem = {
      socketPath: '',
      buildRequest: original,
    };
    const dockerApi = { modem } as any;

    disableSocketRedirects(dockerApi);

    expect(modem.buildRequest).toBe(original);
  });

  test('preserves all buildRequest arguments passed to the original', () => {
    const calls: unknown[][] = [];
    const original = vi.fn((...args: unknown[]) => {
      calls.push(args);
    });
    const modem = {
      socketPath: '/var/run/docker.sock',
      buildRequest: original,
    };
    const dockerApi = { modem } as any;

    disableSocketRedirects(dockerApi);

    const options = { path: '/test' };
    const context = { isStream: false };
    const data = 'payload';
    const callback = vi.fn();

    modem.buildRequest(options, context, data, callback);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([options, context, data, callback]);
  });

  test('handles function-based socketPath', () => {
    const original = vi.fn();
    const modem = {
      socketPath: () => '/var/run/docker.sock',
      buildRequest: original,
    };
    const dockerApi = { modem } as any;

    disableSocketRedirects(dockerApi);

    expect(modem.buildRequest).not.toBe(original);

    const options: Record<string, unknown> = { path: '/test' };
    modem.buildRequest(options, {}, null, vi.fn());

    expect(options.maxRedirects).toBe(0);
    expect(original).toHaveBeenCalledOnce();
  });
});
