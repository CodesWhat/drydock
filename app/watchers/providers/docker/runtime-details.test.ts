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
});
