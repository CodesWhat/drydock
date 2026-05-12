import { vi } from 'vitest';

interface RejectableMock {
  mockRejectedValueOnce(error: unknown): unknown;
}

interface ChildProcessCallbackMockOptions {
  error?: Error | null;
  onCall?: (file: unknown, args: unknown, options: unknown) => void;
  pid?: number;
  stderr?: unknown;
  stdout?: unknown;
}

type ChildProcessCallback = (error: Error | null, stdout: unknown, stderr: unknown) => void;

export function createHttpStatusError(message: string, status: number) {
  return Object.assign(new Error(message), {
    response: { status },
  });
}

export function rejectOnceWithHttpStatus<TMock extends RejectableMock>(
  mock: TMock,
  message: string,
  status: number,
) {
  const error = createHttpStatusError(message, status);
  mock.mockRejectedValueOnce(error);
  return error;
}

export function createRejectedAsyncMethod(message: string | Error) {
  const error = typeof message === 'string' ? new Error(message) : message;
  return vi.fn().mockRejectedValue(error);
}

export function createChildProcessCallbackMock(options: ChildProcessCallbackMockOptions = {}) {
  return (file: unknown, args: unknown, execOptions: unknown, callback: ChildProcessCallback) => {
    options.onCall?.(file, args, execOptions);
    setImmediate(() => {
      callback(options.error ?? null, options.stdout ?? '', options.stderr ?? '');
    });
    return { pid: options.pid ?? 2 };
  };
}
