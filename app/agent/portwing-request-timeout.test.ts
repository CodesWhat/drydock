import { AgentRequestTimeoutError } from './AgentRequestTimeoutError.js';
import {
  clampTimeoutHintMs,
  controllerTimeoutForHint,
  longRequestTimeoutHintMs,
} from './portwing-request-timeout.js';

describe('portwing request timeout hints', () => {
  test('clamps to 1 s .. 15 min', () => {
    expect(clampTimeoutHintMs(0)).toBe(1000);
    expect(clampTimeoutHintMs(999)).toBe(1000);
    expect(clampTimeoutHintMs(1500.9)).toBe(1500);
    expect(clampTimeoutHintMs(900_001)).toBe(900_000);
  });

  test('controller timer is hint + 5 s, or 30 s without a hint', () => {
    expect(controllerTimeoutForHint(undefined)).toBe(30_000);
    expect(controllerTimeoutForHint(60_000)).toBe(65_000);
    expect(controllerTimeoutForHint(10_000_000)).toBe(905_000);
  });

  test.each([
    ['POST', '/containers/abc/stop?t=60', 75_000],
    ['POST', '/v1.43/containers/abc/restart?t=30&x=1', 45_000],
    ['POST', '/containers/abc/stop?t=11', 26_000],
    ['POST', '/containers/abc/stop?t=-1', 900_000],
    ['POST', '/containers/abc/stop?t=99999', 900_000],
    ['POST', '/containers/abc/stop?t=10', undefined],
    ['POST', '/containers/abc/stop?t=0', undefined],
    ['POST', '/containers/abc/stop', undefined],
    ['POST', '/containers/abc/stop?t=soon', undefined],
    ['post', '/containers/abc/wait?condition=next-exit', 900_000],
    ['POST', '/images/load', 900_000],
    ['POST', '/images/prune?filters=x', 900_000],
    ['POST', '/containers/prune/', 900_000],
    ['PUT', '/containers/abc/archive?path=/tmp', 900_000],
    ['PUT', '/containers/abc/other', undefined],
    ['GET', '/containers/abc/archive', undefined],
    ['POST', '/containers/abc/start', undefined],
  ])('%s %s -> %s', (method, target, expected) => {
    expect(longRequestTimeoutHintMs(method, target)).toBe(expected);
  });
});

describe('AgentRequestTimeoutError', () => {
  test('says the operation may still have completed', () => {
    const bare = new AgentRequestTimeoutError();
    expect(bare.code).toBe('request_timeout');
    expect(bare.name).toBe('AgentRequestTimeoutError');
    expect(bare.message).toContain('may still have completed');
    const withDetail = new AgentRequestTimeoutError('docker request exceeded 1m');
    expect(withDetail.message).toMatch(/^docker request exceeded 1m\. .*may still have completed/);
  });
});
