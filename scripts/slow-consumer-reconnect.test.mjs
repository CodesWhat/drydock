import assert from 'node:assert/strict';
import test from 'node:test';

test('keeps the socket paused until a stalled write caused the replacement connection', async () => {
  const { observeSlowConsumerReconnect } = await import('./lib/slow-consumer-reconnect.mjs');
  const calls = [];
  const replacement = { generation: 2 };
  let onChunk;
  let paused = false;
  let ready = false;
  let reconnected = false;
  let timedOut = false;

  const result = await observeSlowConsumerReconnect({
    socket: {
      pause() {
        assert.ok(ready, 'the stream must deliver a frame before pausing');
        paused = true;
        calls.push('pause');
      },
      resume() {
        assert.ok(reconnected && timedOut, 'resume only after the observed eviction');
        paused = false;
        calls.push('resume');
      },
    },
    startStream(callback) {
      onChunk = callback;
      calls.push('start');
      return { cancel: () => calls.push('cancel') };
    },
    async waitFor(description, predicate, timeoutMs) {
      for (let tick = 0; tick < 50; tick += 1) {
        if (!paused && tick === 8) {
          ready = true;
          onChunk();
        }
        if (paused && tick === 20) reconnected = true;
        if (paused && tick === 30) timedOut = true;
        const value = predicate();
        if (value) {
          if (paused) assert.equal(timeoutMs, 45_000);
          return value;
        }
        await Promise.resolve();
      }
      throw new Error(`timed out: ${description}`);
    },
    findReplacement: () => (reconnected ? replacement : undefined),
    hasWriteTimeout: () => timedOut,
    timeoutMs: 45_000,
  });

  assert.equal(result, replacement);
  assert.deepEqual(calls, ['start', 'pause', 'resume', 'cancel']);
});

test('a reconnect without a write timeout cannot satisfy slow-consumer eviction', async () => {
  const { observeSlowConsumerReconnect } = await import('./lib/slow-consumer-reconnect.mjs');
  const calls = [];
  let waits = 0;
  await assert.rejects(
    observeSlowConsumerReconnect({
      socket: { pause: () => calls.push('pause'), resume: () => calls.push('resume') },
      startStream(onChunk) {
        onChunk();
        return { cancel: () => calls.push('cancel') };
      },
      async waitFor(_description, predicate) {
        waits += 1;
        if (waits === 1) return predicate();
        assert.equal(predicate(), undefined);
        throw new Error('no write-timeout eviction');
      },
      findReplacement: () => ({ generation: 2 }),
      hasWriteTimeout: () => false,
      timeoutMs: 45_000,
    }),
    /no write-timeout eviction/,
  );
  assert.deepEqual(calls, ['pause', 'resume', 'cancel']);
});

test('startup failure cancels the stream without pausing the socket', async () => {
  const { observeSlowConsumerReconnect } = await import('./lib/slow-consumer-reconnect.mjs');
  const calls = [];
  await assert.rejects(
    observeSlowConsumerReconnect({
      socket: { pause: () => calls.push('pause'), resume: () => calls.push('resume') },
      startStream: () => ({ cancel: () => calls.push('cancel') }),
      waitFor: async () => {
        throw new Error('no frames');
      },
      findReplacement: () => undefined,
      hasWriteTimeout: () => false,
      timeoutMs: 45_000,
    }),
    /no frames/,
  );
  assert.deepEqual(calls, ['cancel']);
});

test('write-timeout evidence requires both the timed-out write and eviction', async () => {
  const { observedWriteTimeout } = await import('./lib/slow-consumer-reconnect.mjs');
  const failed = 'level=WARN msg="websocket write failed" error="write tcp: i/o timeout"';
  const evicted = 'level=WARN msg="evicting controller connection" reason="write failed"';
  assert.equal(observedWriteTimeout(failed), false);
  assert.equal(observedWriteTimeout(evicted), false);
  assert.equal(observedWriteTimeout(`${failed}\n${evicted}`), true);
  assert.equal(
    observedWriteTimeout(`${failed.replace('i/o timeout', 'connection reset')}\n${evicted}`),
    false,
  );
});
