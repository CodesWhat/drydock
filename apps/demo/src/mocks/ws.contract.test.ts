import { describe, expect, test } from 'vitest';
import { logEntries } from './data/logs';
import {
  buildContainerLogFrames,
  buildSystemLogFrames,
  FakeWebSocket,
  isDemoSocketUrl,
} from './ws';

describe('log stream sockets', () => {
  test('system log frames match the shape the logs view validates', () => {
    const frames = buildSystemLogFrames(new URL('ws://localhost/api/v1/log/stream?tail=100'));
    expect(frames.length).toBe(logEntries.length);
    for (const raw of frames) {
      const frame = JSON.parse(raw);
      expect(frame).toEqual({
        timestamp: expect.any(Number),
        displayTimestamp: expect.any(String),
        level: expect.any(String),
        component: expect.any(String),
        msg: expect.any(String),
      });
    }
  });

  test('system log frames honour the level, component and tail filters', () => {
    const byLevel = buildSystemLogFrames(new URL('ws://localhost/api/v1/log/stream?level=debug'));
    expect(byLevel.length).toBeGreaterThan(0);
    expect(byLevel.every((raw) => JSON.parse(raw).level === 'debug')).toBe(true);
    const byComponent = buildSystemLogFrames(
      new URL('ws://localhost/api/v1/log/stream?component=api'),
    );
    expect(byComponent.every((raw) => JSON.parse(raw).component === 'api')).toBe(true);
    expect(buildSystemLogFrames(new URL('ws://localhost/api/v1/log/stream?tail=2'))).toHaveLength(
      2,
    );
  });

  test('container log frames match the shape the container logs view validates', () => {
    const frames = buildContainerLogFrames(
      new URL(
        'ws://localhost/api/v1/containers/a1b2c3d4e5f6/logs/stream?stdout=true&stderr=true&tail=100',
      ),
    );
    expect(frames.length).toBeGreaterThan(0);
    for (const raw of frames) {
      expect(JSON.parse(raw)).toEqual({
        type: expect.stringMatching(/^(stdout|stderr)$/),
        ts: expect.any(String),
        displayTs: expect.any(String),
        line: expect.any(String),
      });
    }
  });

  test('only api socket urls are faked', () => {
    expect(isDemoSocketUrl('ws://localhost:4179/api/v1/log/stream?tail=100')).toBe(true);
    expect(isDemoSocketUrl('ws://localhost:4179/?token=abc')).toBe(false);
  });

  test('the fake socket opens, replays the frames and closes cleanly', async () => {
    const received: string[] = [];
    const events: string[] = [];
    const socket = new FakeWebSocket('ws://localhost/api/v1/log/stream?tail=3');
    socket.onopen = () => events.push('open');
    socket.onmessage = (event) => received.push(String(event.data));
    socket.onclose = () => events.push('close');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).toEqual(['open']);
    expect(received).toHaveLength(3);
    socket.close(1000, 'manual-close');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(['open', 'close']);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });
});
