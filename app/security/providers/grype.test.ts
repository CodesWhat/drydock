import { describe, expect, test } from 'vitest';
import { buildGrypeInvocation, parseGrypeOutput } from './grype.js';

const MIB = 1024 * 1024;

describe('parseGrypeOutput', () => {
  test('normalizes representative Grype matches into the scanner vulnerability contract', () => {
    const result = parseGrypeOutput(
      JSON.stringify({
        matches: [
          {
            artifact: {
              name: 'openssl',
              version: '3.3.1-r2',
              locations: [{ path: '/usr/lib/libssl.so.3' }],
            },
            vulnerability: {
              id: 'CVE-2026-1000',
              severity: 'High',
              description: 'OpenSSL test vulnerability',
              dataSource: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1000',
              urls: ['https://example.com/advisory'],
              fix: { versions: ['3.3.1-r4'] },
            },
          },
        ],
      }),
    );

    expect(result).toEqual([
      {
        id: 'CVE-2026-1000',
        target: '/usr/lib/libssl.so.3',
        packageName: 'openssl',
        installedVersion: '3.3.1-r2',
        fixedVersion: '3.3.1-r4',
        severity: 'HIGH',
        title: 'OpenSSL test vulnerability',
        primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1000',
      },
    ]);
  });

  test.each([
    ['negligible', 'Negligible'],
    ['unknown provider value', 'Important'],
    ['missing severity', undefined],
  ])('maps %s severity to UNKNOWN', (_label, severity) => {
    const result = parseGrypeOutput(
      JSON.stringify({
        matches: [{ artifact: {}, vulnerability: { id: 'CVE-1', severity } }],
      }),
    );

    expect(result[0]?.severity).toBe('UNKNOWN');
  });

  test.each([
    ['absent matches', {}],
    ['null matches', { matches: null }],
    ['object matches', { matches: {} }],
    ['malformed match entries', { matches: [null, 'bad', 42] }],
  ])('returns no vulnerabilities for %s', (_label, value) => {
    expect(parseGrypeOutput(JSON.stringify(value))).toEqual([]);
  });

  test('selects deterministic target, fixed versions, and fallback URL', () => {
    const result = parseGrypeOutput(
      JSON.stringify({
        matches: [
          {
            artifact: {
              locations: [{ path: '/z/path' }, { path: '/a/path' }, { path: '/a/path' }],
            },
            vulnerability: {
              id: '',
              urls: ['https://z.example/advisory', 'https://a.example/advisory'],
              fix: { versions: ['2.0.0', '1.5.0', '2.0.0', ''] },
            },
          },
        ],
      }),
    );

    expect(result[0]).toMatchObject({
      id: 'unknown-vulnerability',
      target: '/a/path',
      fixedVersion: '1.5.0, 2.0.0',
      primaryUrl: 'https://a.example/advisory',
    });
  });

  test('ignores malformed and pathless artifact locations', () => {
    const result = parseGrypeOutput(
      JSON.stringify({
        matches: [
          {
            artifact: {
              locations: [null, 'not-a-location', {}, { path: '   ' }, { path: '/valid/path' }],
            },
            vulnerability: { id: 'CVE-1' },
          },
        ],
      }),
    );

    expect(result[0]?.target).toBe('/valid/path');
  });

  test('normalizes a match whose artifact and vulnerability payloads are malformed', () => {
    const result = parseGrypeOutput(
      JSON.stringify({ matches: [{ artifact: null, vulnerability: ['invalid'] }] }),
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: 'unknown-vulnerability',
        severity: 'UNKNOWN',
        target: undefined,
      }),
    ]);
  });

  test('prefers a non-empty data source over fallback URLs', () => {
    const result = parseGrypeOutput(
      JSON.stringify({
        matches: [
          {
            artifact: {},
            vulnerability: {
              id: 'CVE-1',
              dataSource: '  https://provider.example/CVE-1  ',
              urls: ['https://fallback.example/CVE-1'],
            },
          },
        ],
      }),
    );

    expect(result[0]?.primaryUrl).toBe('https://provider.example/CVE-1');
  });

  test('rejects Grype JSON larger than the 20 MiB parse limit', () => {
    const output = JSON.stringify({ matches: [], padding: 'x'.repeat(20 * MIB) });

    expect(() => parseGrypeOutput(output)).toThrow('Grype output is too large to parse');
  });
});

describe('buildGrypeInvocation', () => {
  test('builds a registry-first JSON invocation with configured arguments before the image', () => {
    const invocation = buildGrypeInvocation(
      { image: 'registry.example.com/team/app:1.2.3' },
      {
        command: '/usr/local/bin/grype',
        timeout: 180_000,
        extraArgs: ['--only-fixed', '--platform', 'linux/amd64'],
      },
    );

    expect(invocation).toMatchObject({
      command: '/usr/local/bin/grype',
      args: [
        '--output',
        'json',
        '--only-fixed',
        '--platform',
        'linux/amd64',
        'registry:registry.example.com/team/app:1.2.3',
      ],
      timeout: 180_000,
      maxBuffer: 50 * MIB,
      commandName: 'Grype',
    });
  });

  test('falls back to the grype command and preserves the inherited environment', () => {
    const invocation = buildGrypeInvocation(
      { image: 'alpine:3.22' },
      { command: '  ', timeout: 60_000 },
    );

    expect(invocation.command).toBe('grype');
    expect(invocation.args).toEqual(['--output', 'json', 'registry:alpine:3.22']);
    expect(invocation.env.PATH).toBe(process.env.PATH);
  });

  test('uses the default command when no command is configured', () => {
    const invocation = buildGrypeInvocation({ image: 'alpine:3.22' }, { timeout: 60_000 });

    expect(invocation.command).toBe('grype');
  });

  test('passes registry credentials through the official Syft environment variables', () => {
    const invocation = buildGrypeInvocation(
      {
        image: 'private.example.com/app:latest',
        auth: { username: 'robot', password: 'secret' },
      },
      { command: 'grype', timeout: 60_000 },
    );

    expect(invocation.env.SYFT_REGISTRY_AUTH_USERNAME).toBe('robot');
    expect(invocation.env.SYFT_REGISTRY_AUTH_PASSWORD).toBe('secret');
    expect(invocation.args.join(' ')).not.toContain('secret');
  });

  test('uses an empty registry username when only a password is supplied', () => {
    const invocation = buildGrypeInvocation(
      { image: 'private.example.com/app:latest', auth: { password: 'secret' } },
      { command: 'grype', timeout: 60_000 },
    );

    expect(invocation.env.SYFT_REGISTRY_AUTH_USERNAME).toBe('');
    expect(invocation.env.SYFT_REGISTRY_AUTH_PASSWORD).toBe('secret');
  });

  test('does not add registry auth variables when no password is supplied', () => {
    const invocation = buildGrypeInvocation(
      { image: 'alpine:3.22', auth: { username: 'unused' } },
      { command: 'grype', timeout: 60_000 },
    );

    expect(invocation.env.SYFT_REGISTRY_AUTH_USERNAME).toBeUndefined();
    expect(invocation.env.SYFT_REGISTRY_AUTH_PASSWORD).toBeUndefined();
  });

  test.each(['../bin/grype', 'grype;echo'])('rejects invalid command path %s', (command) => {
    expect(() =>
      buildGrypeInvocation({ image: 'alpine:3.22' }, { command, timeout: 60_000 }),
    ).toThrow('Grype command');
  });

  test.each([
    ['non-array', 'not-an-array'],
    ['empty argument', ['--only-fixed', '']],
    ['NUL byte', ['--platform\0linux/amd64']],
    ['output override', ['--output', 'table']],
    ['short output override', ['-o=json']],
    ['file output', ['--file=result.json']],
  ])('rejects %s configured extra arguments', (_label, extraArgs) => {
    expect(() =>
      buildGrypeInvocation(
        { image: 'alpine:3.22' },
        { command: 'grype', timeout: 60_000, extraArgs: extraArgs as string[] },
      ),
    ).toThrow('Grype extra arguments');
  });
});
