import { describe, expect, test } from 'vitest';
import { usesControllerDockerTransport } from './controller-docker-transport.js';

describe('usesControllerDockerTransport', () => {
  test('accepts only the exact Portwing controller-owned Docker marker', () => {
    expect(
      usesControllerDockerTransport('docker', {
        transport: 'docker-api',
        execution: 'controller',
        events: 'portwing',
      }),
    ).toBe(true);
  });

  test.each([
    [
      'non-Docker type',
      'podman',
      { transport: 'docker-api', execution: 'controller', events: 'portwing' },
    ],
    ['missing configuration', 'docker', undefined],
    ['primitive configuration', 'docker', 'docker-api'],
    ['array configuration', 'docker', []],
    [
      'wrong transport',
      'docker',
      { transport: 'agent', execution: 'controller', events: 'portwing' },
    ],
    [
      'wrong execution',
      'docker',
      { transport: 'docker-api', execution: 'agent', events: 'portwing' },
    ],
    [
      'wrong events',
      'docker',
      { transport: 'docker-api', execution: 'controller', events: 'docker' },
    ],
  ])('rejects %s', (_label, type, configuration) => {
    expect(usesControllerDockerTransport(type, configuration)).toBe(false);
  });
});
