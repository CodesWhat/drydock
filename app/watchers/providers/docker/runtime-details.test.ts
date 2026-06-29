import { describe, expect, test } from 'vitest';

import {
  areRuntimeDetailsEqual,
  getRuntimeDetailsFromContainerSummary,
  getRuntimeDetailsFromInspect,
  mergeRuntimeDetails,
  normalizeRuntimeDetails,
} from './runtime-details.js';

describe('docker runtime details module', () => {
  test('extracts and normalizes runtime details from inspect payload', () => {
    const details = getRuntimeDetailsFromInspect({
      NetworkSettings: {
        Ports: {
          '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
          '443/tcp': null,
        },
      },
      Mounts: [
        { Name: 'named-volume', Destination: '/data', RW: false },
        { Source: '/host/config', Destination: '/config', RW: true },
      ],
      Config: {
        Env: ['APP_ENV=prod', 'DEBUG=', ' APP_ENV=prod ', 'NO_EQUALS'],
      },
    } as any);

    expect(details).toEqual({
      ports: ['0.0.0.0:8080->80/tcp', '443/tcp'],
      volumes: ['named-volume:/data:ro', '/host/config:/config'],
      env: [
        { key: 'APP_ENV', value: 'prod' },
        { key: 'DEBUG', value: '' },
        { key: 'APP_ENV', value: 'prod ' },
        { key: 'NO_EQUALS', value: '' },
      ],
    });
  });

  test('handles empty and malformed inspect port bindings predictably', () => {
    const details = getRuntimeDetailsFromInspect({
      NetworkSettings: {
        Ports: {
          '80/tcp': [],
          '81/tcp': [{ HostIp: '0.0.0.0', HostPort: '8081' }],
          '82/tcp': [null, 'oops'],
          '83/tcp': [{ HostPort: null }, { HostPort: '' }],
        },
      },
    } as any);

    expect(details.ports).toEqual(['80/tcp', '0.0.0.0:8081->81/tcp', '83/tcp']);
  });

  test('formats inspect mounts with source precedence and read-only suffix rules', () => {
    const details = getRuntimeDetailsFromInspect({
      Mounts: [
        { Name: ' named-volume ', Source: '/ignored', Destination: ' /data ', RW: false },
        { Source: ' /host/config ', Destination: ' /config ', RW: true },
        { Source: '/host-only', RW: false },
        { Destination: '/dest-only', RW: false },
        { Source: ' ', Destination: '' },
      ],
    } as any);

    expect(details.volumes).toEqual([
      'named-volume:/data:ro',
      '/host/config:/config',
      '/host-only:ro',
      '/dest-only:ro',
    ]);
  });

  test('extracts summary runtime details and leaves env empty', () => {
    const details = getRuntimeDetailsFromContainerSummary({
      Ports: [
        { PrivatePort: 3000, Type: 'tcp', PublicPort: 13000, IP: '127.0.0.1' },
        { PrivatePort: 53, Type: 'udp' },
      ],
      Mounts: [{ Source: '/host/logs', Destination: '/logs', RW: false }],
    } as any);

    expect(details).toEqual({
      ports: ['127.0.0.1:13000->3000/tcp', '53/udp'],
      volumes: ['/host/logs:/logs:ro'],
      env: [],
    });
  });

  test('prefers non-empty inspect details over summary fallback', () => {
    const merged = mergeRuntimeDetails(
      {
        ports: ['80/tcp'],
        volumes: [],
        env: [{ key: 'A', value: '1' }],
      },
      {
        ports: ['8080->80/tcp'],
        volumes: ['/host:/data'],
        env: [{ key: 'B', value: '2' }],
      },
    );

    expect(merged).toEqual({
      ports: ['80/tcp'],
      volumes: ['/host:/data'],
      env: [{ key: 'A', value: '1' }],
    });
  });

  test('normalization and equality ignore invalid runtime detail values', () => {
    const normalized = normalizeRuntimeDetails({
      ports: ['8080->80/tcp', '8080->80/tcp', '   '],
      volumes: ['/data:/app', '/data:/app'],
      env: [
        null,
        { key: 'A', value: 1 },
        { key: 'A', value: '1' },
        { key: 'B' },
        {},
        { key: ' ', value: 'x' },
      ],
    });

    expect(normalized).toEqual({
      ports: ['8080->80/tcp'],
      volumes: ['/data:/app'],
      env: [
        { key: 'A', value: '1' },
        { key: 'B', value: '' },
      ],
    });

    expect(
      areRuntimeDetailsEqual(normalized, {
        ports: ['8080->80/tcp'],
        volumes: ['/data:/app'],
        env: [
          { key: 'A', value: '1' },
          { key: 'B', value: '' },
        ],
      }),
    ).toBe(true);
  });

  test('runtime details equality does not rely on JSON.stringify', () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    try {
      const equal = areRuntimeDetailsEqual(
        {
          ports: ['8080->80/tcp'],
          volumes: ['/data:/app'],
          env: [{ key: 'A', value: '1' }],
        },
        {
          ports: ['8080->80/tcp'],
          volumes: ['/data:/app'],
          env: [{ key: 'A', value: '1' }],
        },
      );

      expect(equal).toBe(true);
      expect(stringifySpy).not.toHaveBeenCalled();
    } finally {
      stringifySpy.mockRestore();
    }
  });

  test('runtime details equality returns false when port list length differs', () => {
    expect(
      areRuntimeDetailsEqual(
        {
          ports: ['80/tcp'],
          volumes: ['/data:/app'],
          env: [{ key: 'A', value: '1' }],
        },
        {
          ports: [],
          volumes: ['/data:/app'],
          env: [{ key: 'A', value: '1' }],
        },
      ),
    ).toBe(false);
  });

  test('runtime details equality returns false when volume entries differ', () => {
    expect(
      areRuntimeDetailsEqual(
        {
          ports: ['80/tcp'],
          volumes: ['/data:/app'],
          env: [{ key: 'A', value: '1' }],
        },
        {
          ports: ['80/tcp'],
          volumes: ['/other:/app'],
          env: [{ key: 'A', value: '1' }],
        },
      ),
    ).toBe(false);
  });

  test('runtime details equality returns false when env entries differ', () => {
    expect(
      areRuntimeDetailsEqual(
        {
          ports: ['80/tcp'],
          volumes: ['/data:/app'],
          env: [{ key: 'A', value: '1' }],
        },
        {
          ports: ['80/tcp'],
          volumes: ['/data:/app'],
          env: [{ key: 'A', value: '2' }],
        },
      ),
    ).toBe(false);
  });

  test('skips malformed inspect runtime values while preserving valid values', () => {
    const details = getRuntimeDetailsFromInspect({
      NetworkSettings: {
        Ports: {
          '80/tcp': [
            null,
            { HostIp: '', HostPort: null },
            { HostIp: '', HostPort: '9000' },
            { HostIp: '127.0.0.1', HostPort: 8080 },
          ],
          '53/udp': [{}],
        },
      },
      Mounts: [
        null,
        { Source: '', Destination: '' },
        { Source: '/host-only', Destination: '', RW: false },
        { Destination: '/dest-only', RW: true },
      ],
      Config: {
        Env: [undefined, '', ' =oops', 'KEY=1', 'NOSEP', 42],
      },
    } as any);

    expect(details).toEqual({
      ports: ['80/tcp', '9000->80/tcp', '127.0.0.1:8080->80/tcp', '53/udp'],
      volumes: ['/host-only:ro', '/dest-only'],
      env: [
        { key: 'KEY', value: '1' },
        { key: 'NOSEP', value: '' },
      ],
    });
  });

  test('skips malformed summary runtime values while preserving valid values', () => {
    const details = getRuntimeDetailsFromContainerSummary({
      Ports: [
        null,
        { PublicPort: 8080 },
        { PrivatePort: null, Type: 'udp' },
        { PrivatePort: 5000, Type: '', PublicPort: null, IP: '1.1.1.1' },
        { PrivatePort: 6000, PublicPort: 16000, IP: '' },
      ],
      Mounts: [
        undefined,
        { Name: 'named', Destination: '/named', RW: true },
        { Source: '', Destination: '' },
      ],
    } as any);

    expect(details).toEqual({
      ports: ['5000/tcp', '16000->6000/tcp'],
      volumes: ['named:/named'],
      env: [],
    });
  });

  test('extracts startedAt from inspect State when present and valid', () => {
    const details = getRuntimeDetailsFromInspect({
      State: { StartedAt: '2024-06-01T12:00:00Z' },
    } as any);
    expect(details.startedAt).toBe('2024-06-01T12:00:00Z');
  });

  test('omits startedAt when State is missing', () => {
    const details = getRuntimeDetailsFromInspect({} as any);
    expect(details.startedAt).toBeUndefined();
  });

  test('omits startedAt when State.StartedAt is the Docker zero-time sentinel', () => {
    const details = getRuntimeDetailsFromInspect({
      State: { StartedAt: '0001-01-01T00:00:00Z' },
    } as any);
    expect(details.startedAt).toBeUndefined();
  });

  test('omits startedAt when State.StartedAt starts with 0001-', () => {
    const details = getRuntimeDetailsFromInspect({
      State: { StartedAt: '0001-01-01T00:00:00.000Z' },
    } as any);
    expect(details.startedAt).toBeUndefined();
  });

  test('omits startedAt when State.StartedAt is not a string', () => {
    const details = getRuntimeDetailsFromInspect({
      State: { StartedAt: null },
    } as any);
    expect(details.startedAt).toBeUndefined();
  });

  test('omits startedAt when State.StartedAt is an empty string', () => {
    const details = getRuntimeDetailsFromInspect({
      State: { StartedAt: '' },
    } as any);
    expect(details.startedAt).toBeUndefined();
  });

  test('merge prefers startedAt from preferred details', () => {
    const merged = mergeRuntimeDetails(
      { ports: [], volumes: [], env: [], startedAt: '2024-06-01T12:00:00Z' },
      { ports: [], volumes: [], env: [], startedAt: '2023-01-01T00:00:00Z' },
    );
    expect(merged.startedAt).toBe('2024-06-01T12:00:00Z');
  });

  test('merge falls back to fallback startedAt when preferred has none', () => {
    const merged = mergeRuntimeDetails(
      { ports: [], volumes: [], env: [] },
      { ports: [], volumes: [], env: [], startedAt: '2023-01-01T00:00:00Z' },
    );
    expect(merged.startedAt).toBe('2023-01-01T00:00:00Z');
  });

  test('merge yields undefined startedAt when neither preferred nor fallback has one', () => {
    const merged = mergeRuntimeDetails(
      { ports: [], volumes: [], env: [] },
      { ports: [], volumes: [], env: [] },
    );
    expect(merged.startedAt).toBeUndefined();
  });

  test('areRuntimeDetailsEqual returns false when startedAt differs', () => {
    expect(
      areRuntimeDetailsEqual(
        { ports: [], volumes: [], env: [], startedAt: '2024-06-01T12:00:00Z' },
        { ports: [], volumes: [], env: [], startedAt: '2024-06-02T12:00:00Z' },
      ),
    ).toBe(false);
  });

  test('areRuntimeDetailsEqual returns false when one has startedAt and the other does not', () => {
    expect(
      areRuntimeDetailsEqual(
        { ports: [], volumes: [], env: [], startedAt: '2024-06-01T12:00:00Z' },
        { ports: [], volumes: [], env: [] },
      ),
    ).toBe(false);
  });

  test('areRuntimeDetailsEqual returns true when both have the same startedAt', () => {
    expect(
      areRuntimeDetailsEqual(
        { ports: [], volumes: [], env: [], startedAt: '2024-06-01T12:00:00Z' },
        { ports: [], volumes: [], env: [], startedAt: '2024-06-01T12:00:00Z' },
      ),
    ).toBe(true);
  });

  test('normalizeRuntimeDetails carries startedAt through', () => {
    const normalized = normalizeRuntimeDetails({
      ports: [],
      volumes: [],
      env: [],
      startedAt: '2024-06-01T12:00:00Z',
    });
    expect(normalized.startedAt).toBe('2024-06-01T12:00:00Z');
  });

  test('normalizeRuntimeDetails omits startedAt when not a non-empty string', () => {
    expect(
      normalizeRuntimeDetails({ ports: [], volumes: [], env: [], startedAt: '' }).startedAt,
    ).toBeUndefined();
    expect(
      normalizeRuntimeDetails({ ports: [], volumes: [], env: [], startedAt: null }).startedAt,
    ).toBeUndefined();
    expect(normalizeRuntimeDetails({ ports: [], volumes: [], env: [] }).startedAt).toBeUndefined();
  });
});
