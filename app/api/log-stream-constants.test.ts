import {
  LOG_STREAM_RATE_LIMIT_MAX,
  LOG_STREAM_RATE_LIMIT_WINDOW_MS,
  WS_CLOSE_CODE_CONTAINER_NOT_FOUND,
  WS_CLOSE_CODE_CONTAINER_NOT_RUNNING,
  WS_CLOSE_CODE_INTERNAL_ERROR,
  WS_CLOSE_CODE_NORMAL,
} from './log-stream-constants.js';

describe('api/log-stream-constants', () => {
  test('exports stable websocket close codes and rate-limit defaults', () => {
    expect(LOG_STREAM_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(LOG_STREAM_RATE_LIMIT_MAX).toBe(1000);
    expect(WS_CLOSE_CODE_NORMAL).toBe(1000);
    expect(WS_CLOSE_CODE_INTERNAL_ERROR).toBe(1011);
    expect(WS_CLOSE_CODE_CONTAINER_NOT_RUNNING).toBe(4001);
    expect(WS_CLOSE_CODE_CONTAINER_NOT_FOUND).toBe(4004);
  });
});
