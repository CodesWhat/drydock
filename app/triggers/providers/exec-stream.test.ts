import { waitForExecStream } from './exec-stream.js';

function makeStream({
  hasOnce = true,
  emitEvent = 'close' as string | null,
  emitError = undefined as unknown,
} = {}) {
  const listeners: Record<string, ((error?: unknown) => void)[]> = {};

  const stream = {
    once: hasOnce
      ? (event: string, cb: (error?: unknown) => void) => {
          if (!listeners[event]) {
            listeners[event] = [];
          }
          listeners[event].push(cb);
        }
      : undefined,
    removeListener: (event: string, cb: (error?: unknown) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((fn) => fn !== cb);
      }
    },
    emit(event: string, arg?: unknown) {
      for (const fn of listeners[event] ?? []) {
        fn(arg);
      }
    },
  };

  return { stream, emit: stream.emit.bind(stream) };
}

describe('waitForExecStream', () => {
  test('resolves immediately when stream has no once handler', async () => {
    const { stream } = makeStream({ hasOnce: false });
    await expect(waitForExecStream(stream)).resolves.toBeUndefined();
  });

  test('resolves when close event fires', async () => {
    const { stream, emit } = makeStream({ emitEvent: 'close' });
    const promise = waitForExecStream(stream);
    emit('close');
    await expect(promise).resolves.toBeUndefined();
  });

  test('resolves when end event fires', async () => {
    const { stream, emit } = makeStream({ emitEvent: 'end' });
    const promise = waitForExecStream(stream);
    emit('end');
    await expect(promise).resolves.toBeUndefined();
  });

  test('rejects when error event fires', async () => {
    const { stream, emit } = makeStream();
    const promise = waitForExecStream(stream);
    emit('error', new Error('stream exploded'));
    await expect(promise).rejects.toThrow('stream exploded');
  });

  test('removes end and close listeners after error fires', async () => {
    const { stream, emit } = makeStream();
    const promise = waitForExecStream(stream);
    emit('error', new Error('boom'));
    await expect(promise).rejects.toThrow('boom');
    // Additional close/end should not throw or cause issues
    emit('close');
    emit('end');
  });

  test('removes error listener after close fires', async () => {
    const { stream, emit } = makeStream();
    const promise = waitForExecStream(stream);
    emit('close');
    await expect(promise).resolves.toBeUndefined();
    // Error emitted after resolve should be a no-op
    emit('error', new Error('late error'));
  });

  test('removes error listener after end fires', async () => {
    const { stream, emit } = makeStream();
    const promise = waitForExecStream(stream);
    emit('end');
    await expect(promise).resolves.toBeUndefined();
    // Error emitted after resolve should be a no-op
    emit('error', new Error('late error'));
  });
});
