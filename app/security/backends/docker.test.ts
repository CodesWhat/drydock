import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import { createDockerScannerBackend, type DockerScannerRegistryAuth } from './docker.js';

const PINNED_IMAGE = `registry.example.com/security/trivy@sha256:${'a'.repeat(64)}`;

type HarnessOptions = {
  exitCode?: number;
  inspect?: Record<string, unknown>;
  stdout?: string;
  stderr?: string;
  wait?: () => Promise<{ StatusCode: number }>;
};

function createHarness(options: HarnessOptions = {}) {
  const stream = new EventEmitter();
  const container = {
    attach: vi.fn(async () => stream),
    start: vi.fn(async () => undefined),
    wait: vi.fn(options.wait || (async () => ({ StatusCode: options.exitCode ?? 0 }))),
    stop: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  const createContainer = vi.fn(async () => container);
  const inspect = vi.fn(async () =>
    Promise.resolve(
      options.inspect || {
        Id: `sha256:${'b'.repeat(64)}`,
        RepoDigests: [`registry.example.com/security/trivy@sha256:${'a'.repeat(64)}`],
        Config: { Labels: { 'org.opencontainers.image.version': '0.70.0' } },
      },
    ),
  );
  const pullStream = {};
  const pull = vi.fn((_image, _pullOptions, callback) => callback(null, pullStream));
  const followProgress = vi.fn((_stream, callback) => callback(null, [{ status: 'done' }]));
  const demuxStream = vi.fn((_stream, stdout, stderr) => {
    if (options.stdout) stdout.write(Buffer.from(options.stdout));
    if (options.stderr) stderr.write(Buffer.from(options.stderr));
    queueMicrotask(() => stream.emit('end'));
  });
  const client = {
    createContainer,
    getImage: vi.fn(() => ({ inspect })),
    modem: { demuxStream, followProgress },
    pull,
  };
  const backend = createDockerScannerBackend({
    client,
    cacheDir: '/var/lib/drydock/scanner-cache/trivy',
  });

  return {
    backend,
    client,
    container,
    createContainer,
    demuxStream,
    followProgress,
    inspect,
    pull,
    pullStream,
    stream,
  };
}

describe('createDockerScannerBackend', () => {
  test('requires a Docker client', () => {
    expect(() =>
      createDockerScannerBackend({
        client: undefined as never,
        cacheDir: '/scanner-cache',
      }),
    ).toThrow('requires a client');
  });

  test.each([
    'scanner-cache',
    '/',
    '/bad\0cache',
    '/var/run/docker.sock',
  ])('rejects unsafe cache directory %j', (cacheDir) => {
    const { client } = createHarness();
    expect(() => createDockerScannerBackend({ client, cacheDir })).toThrow(
      'safe absolute provider cache directory',
    );
  });

  test.each([
    { hardening: { cacheTarget: 'cache' }, message: 'cacheTarget' },
    { hardening: { cacheTarget: '/' }, message: 'cacheTarget' },
    { hardening: { cacheTarget: '/bad\0target' }, message: 'cacheTarget' },
    { hardening: { memoryBytes: 1.5 }, message: 'memoryBytes' },
    { hardening: { pidsLimit: 0 }, message: 'pidsLimit' },
    { hardening: { tmpfsSizeBytes: -1 }, message: 'tmpfsSizeBytes' },
    { hardening: { networkMode: ' ' }, message: 'networkMode' },
    { hardening: { networkMode: 'bad\0network' }, message: 'networkMode' },
  ])('rejects invalid hardening option: $message', ({ hardening, message }) => {
    const { client } = createHarness();
    expect(() =>
      createDockerScannerBackend({
        client,
        cacheDir: '/scanner-cache',
        hardening,
      }),
    ).toThrow(message);
  });

  test('rejects unpinned worker image references', async () => {
    const { backend, pull, createContainer } = createHarness();

    await expect(backend.pullImage('aquasec/trivy:latest')).rejects.toThrow(
      'must be pinned by sha256 digest',
    );
    await expect(
      backend.run({
        image: 'aquasec/trivy:latest',
        args: ['image', 'alpine:3.20'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('must be pinned by sha256 digest');
    await expect(backend.inspectImage('aquasec/trivy:latest')).rejects.toThrow(
      'must be pinned by sha256 digest',
    );
    expect(pull).not.toHaveBeenCalled();
    expect(createContainer).not.toHaveBeenCalled();
  });

  test('pulls a pinned worker image through followProgress with registry auth', async () => {
    const { backend, followProgress, pull, pullStream } = createHarness();
    const auth = {
      username: 'scanner-user',
      password: 'scanner-token',
      serveraddress: 'registry.example.com',
    };

    await backend.pullImage(PINNED_IMAGE, auth);

    expect(pull).toHaveBeenCalledWith(PINNED_IMAGE, { authconfig: auth }, expect.any(Function));
    expect(followProgress).toHaveBeenCalledWith(pullStream, expect.any(Function));
  });

  test('single-flights concurrent pulls for the same pinned worker image', async () => {
    const { backend, followProgress, pull } = createHarness();
    let finishPull: ((error: Error | null) => void) | undefined;
    followProgress.mockImplementationOnce((_stream, callback) => {
      finishPull = callback;
    });

    const first = backend.pullImage(PINNED_IMAGE);
    const second = backend.pullImage(PINNED_IMAGE);
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());
    finishPull?.(null);

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(followProgress).toHaveBeenCalledOnce();
  });

  test('clears failed pull single-flight state so a later pull can retry', async () => {
    const { backend, followProgress, pull } = createHarness();
    followProgress.mockImplementationOnce((_stream, callback) => callback(new Error('denied')));

    await expect(backend.pullImage(PINNED_IMAGE)).rejects.toThrow('denied');
    await expect(backend.pullImage(PINNED_IMAGE)).resolves.toBeUndefined();

    expect(pull).toHaveBeenCalledTimes(2);
  });

  test('reports Docker pull callback failures and missing progress streams', async () => {
    const pullFailure = createHarness();
    pullFailure.pull.mockImplementationOnce((_image, _options, callback) =>
      callback(new Error('pull failed')),
    );
    await expect(pullFailure.backend.pullImage(PINNED_IMAGE)).rejects.toThrow('pull failed');

    const missingStream = createHarness();
    missingStream.pull.mockImplementationOnce((_image, _options, callback) =>
      callback(null, undefined),
    );
    await expect(missingStream.backend.pullImage(PINNED_IMAGE)).rejects.toThrow(
      'no progress stream',
    );
  });

  test('reports synchronous followProgress failures', async () => {
    const { backend, followProgress } = createHarness();
    followProgress.mockImplementationOnce(() => {
      throw new Error('progress unavailable');
    });

    await expect(backend.pullImage(PINNED_IMAGE)).rejects.toThrow('progress unavailable');
  });

  test('validates registry authentication without passing unknown fields', async () => {
    const { backend, pull } = createHarness();

    await expect(backend.pullImage(PINNED_IMAGE, { username: `bad\0user` })).rejects.toThrow(
      'without null bytes',
    );
    await backend.pullImage(PINNED_IMAGE, {
      username: 'safe',
      unknown: 'discarded',
    } as DockerScannerRegistryAuth & {
      unknown: string;
    });

    expect(pull).toHaveBeenLastCalledWith(
      PINNED_IMAGE,
      { authconfig: { username: 'safe' } },
      expect.any(Function),
    );
  });

  test('runs without a shell or socket bind and applies hardened defaults', async () => {
    const { backend, createContainer, container, pull } = createHarness({
      stdout: '{"matches":[]}',
      stderr: 'scanner notice',
    });

    const result = await backend.run({
      image: PINNED_IMAGE,
      args: ['-o', 'json', 'alpine:3.20'],
      env: { GRYPE_DB_CACHE_DIR: '/cache' },
      timeoutMs: 2_000,
      maxOutputBytes: 16_384,
    });

    expect(pull).not.toHaveBeenCalled();
    expect(createContainer).toHaveBeenCalledWith({
      Image: PINNED_IMAGE,
      Cmd: ['-o', 'json', 'alpine:3.20'],
      Env: ['GRYPE_DB_CACHE_DIR=/cache'],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      OpenStdin: false,
      HostConfig: {
        AutoRemove: false,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        PidsLimit: 64,
        Memory: 512 * 1024 * 1024,
        NetworkMode: 'none',
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=64m' },
        Mounts: [
          {
            Type: 'bind',
            Source: '/var/lib/drydock/scanner-cache/trivy',
            Target: '/cache',
            ReadOnly: false,
          },
        ],
      },
    });
    const createSpec = createContainer.mock.calls[0][0];
    expect(createSpec).not.toHaveProperty('Entrypoint');
    expect(JSON.stringify(createSpec)).not.toContain('/var/run/docker.sock');
    expect(container.attach).toHaveBeenCalledWith({
      stream: true,
      stdout: true,
      stderr: true,
    });
    expect(container.start).toHaveBeenCalledOnce();
    expect(container.remove).toHaveBeenCalledWith({ force: true });
    expect(result).toEqual({ exitCode: 0, stdout: '{"matches":[]}', stderr: 'scanner notice' });
  });

  test('pulls the worker only when the pinned image is missing locally', async () => {
    const { backend, inspect, pull } = createHarness();
    inspect.mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 404 }));

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['version'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).resolves.toMatchObject({ exitCode: 0 });

    expect(pull).toHaveBeenCalledOnce();
  });

  test('bounds explicit worker image pulls', async () => {
    const { backend, pull } = createHarness();
    pull.mockImplementationOnce(() => undefined);

    await expect(backend.pullImage(PINNED_IMAGE, undefined, 10)).rejects.toThrow(
      'timed out after 10ms',
    );
  });

  test('uses explicit bounded hardening and network overrides', async () => {
    const { client } = createHarness();
    const backend = createDockerScannerBackend({
      client,
      cacheDir: '/scanner-cache',
      hardening: {
        cacheTarget: '/var/cache/grype',
        memoryBytes: 768 * 1024 * 1024,
        networkMode: 'scanner-net',
        pidsLimit: 32,
        tmpfsSizeBytes: 32 * 1024 * 1024,
      },
    });

    await backend.run({
      image: PINNED_IMAGE,
      args: ['version'],
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    });

    expect(client.createContainer.mock.calls[0][0].HostConfig).toMatchObject({
      Memory: 768 * 1024 * 1024,
      NetworkMode: 'scanner-net',
      PidsLimit: 32,
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=32m' },
      Mounts: [
        {
          Type: 'bind',
          Source: '/scanner-cache',
          Target: '/var/cache/grype',
          ReadOnly: false,
        },
      ],
    });
  });

  test('mounts a named Docker volume as the scanner cache', async () => {
    const { client } = createHarness();
    const backend = createDockerScannerBackend({
      client,
      cacheDir: 'volume:drydock-grype-cache',
    });

    await backend.run({
      image: PINNED_IMAGE,
      args: ['version'],
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    });

    expect(client.createContainer.mock.calls[0][0].HostConfig).toMatchObject({
      Mounts: [
        {
          Type: 'volume',
          Source: 'drydock-grype-cache',
          Target: '/cache',
          ReadOnly: false,
        },
      ],
    });
  });

  test('propagates non-not-found image inspection failures without pulling', async () => {
    const { backend, createContainer, inspect, pull } = createHarness();
    inspect.mockRejectedValueOnce(
      Object.assign(new Error('daemon unavailable'), { statusCode: 503 }),
    );

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['version'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('daemon unavailable');

    expect(pull).not.toHaveBeenCalled();
    expect(createContainer).not.toHaveBeenCalled();
  });

  test('rejects when image preparation exhausts the worker runtime budget', async () => {
    const { backend, createContainer } = createHarness();
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_001);

    try {
      await expect(
        backend.run({
          image: PINNED_IMAGE,
          args: ['version'],
          timeoutMs: 1_000,
          maxOutputBytes: 1_024,
        }),
      ).rejects.toThrow('Scanner worker timed out after 1000ms');
    } finally {
      now.mockRestore();
    }

    expect(createContainer).not.toHaveBeenCalled();
  });

  test.each([
    { args: [], env: undefined, timeoutMs: 1_000, maxOutputBytes: 1_024, message: 'args' },
    {
      args: ['scan\0image'],
      env: undefined,
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      message: 'args',
    },
    {
      args: ['scan'],
      env: { 'INVALID-KEY': 'value' },
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      message: 'environment variable name',
    },
    {
      args: ['scan'],
      env: { TOKEN: 'bad\0value' },
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      message: 'environment variable value',
    },
    {
      args: ['scan'],
      env: { TOKEN: 42 } as never,
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      message: 'environment variable value',
    },
    {
      args: new Array(257).fill('scan'),
      env: undefined,
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      message: 'args',
    },
    {
      args: [42] as never,
      env: undefined,
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      message: 'args',
    },
    {
      args: ['x'.repeat(64 * 1024 + 1)],
      env: undefined,
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      message: 'args',
    },
    {
      args: ['scan'],
      env: Object.fromEntries(new Array(129).fill(0).map((_, index) => [`KEY_${index}`, 'x'])),
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      message: 'env',
    },
    { args: ['scan'], env: undefined, timeoutMs: 0, maxOutputBytes: 1_024, message: 'timeoutMs' },
    {
      args: ['scan'],
      env: undefined,
      timeoutMs: 1_000,
      maxOutputBytes: 0,
      message: 'maxOutputBytes',
    },
  ])('rejects invalid run input before pulling: $message', async (input) => {
    const { backend, pull } = createHarness();

    await expect(backend.run({ image: PINNED_IMAGE, ...input })).rejects.toThrow(input.message);
    expect(pull).not.toHaveBeenCalled();
  });

  test('bounds combined demultiplexed output and removes the worker', async () => {
    const { backend, container, demuxStream } = createHarness();
    demuxStream.mockImplementationOnce((_stream, stdout, stderr) => {
      stdout.write('123456');
      stderr.write('abcdef');
      stderr.write('ignored');
    });

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 10,
      }),
    ).rejects.toThrow('exceeded 10 bytes');

    expect(container.stop).toHaveBeenCalledWith({ t: 0 });
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  test('detects an output limit after an already-resolved wait and stream completion', async () => {
    const { backend, container } = createHarness({ stdout: '123456', stderr: 'abcdef' });

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 10,
      }),
    ).rejects.toThrow('exceeded 10 bytes');
    expect(container.stop).toHaveBeenCalledWith({ t: 0 });
  });

  test('stops and removes a worker that exceeds its timeout', async () => {
    const { backend, container } = createHarness({ wait: () => new Promise(() => undefined) });

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 10,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('timed out after 10ms');

    expect(container.stop).toHaveBeenCalledWith({ t: 0 });
    expect(container.kill).not.toHaveBeenCalled();
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  test('kills a timed-out worker when stopping fails', async () => {
    const { backend, container } = createHarness({ wait: () => new Promise(() => undefined) });
    container.stop.mockRejectedValueOnce(new Error('stop failed'));

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 10,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('timed out after 10ms');

    expect(container.kill).toHaveBeenCalledOnce();
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  test('reports nonzero exits with bounded stderr and always removes the worker', async () => {
    const { backend, container } = createHarness({ exitCode: 7, stderr: 'database unavailable' });

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('exited with status 7: database unavailable');

    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  test('reports a nonzero exit without appending an empty stderr suffix', async () => {
    const { backend } = createHarness({ exitCode: 2 });

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow(/^Scanner worker exited with status 2$/);
  });

  test('always removes a created worker when start fails', async () => {
    const { backend, container } = createHarness();
    container.start.mockRejectedValueOnce(new Error('start failed'));

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('start failed');

    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  test('does not leak an output-limit rejection when startup fails first', async () => {
    const { backend, container, demuxStream } = createHarness();
    demuxStream.mockImplementationOnce((_stream, stdout) => stdout.write('too much output'));
    container.start.mockRejectedValueOnce(new Error('start failed'));

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 1,
      }),
    ).rejects.toThrow('start failed');
    await new Promise((resolve) => setImmediate(resolve));
  });

  test('does not attempt container removal when creation fails', async () => {
    const { backend, client, container } = createHarness();
    client.createContainer.mockRejectedValueOnce(new Error('create failed'));

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('create failed');
    expect(container.remove).not.toHaveBeenCalled();
  });

  test('accepts attach streams without event methods', async () => {
    const { backend, container } = createHarness();
    container.attach.mockResolvedValueOnce({});

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  test('accepts close as the terminal attached-stream event', async () => {
    const { backend, demuxStream, stream } = createHarness();
    demuxStream.mockImplementationOnce(() => queueMicrotask(() => stream.emit('close')));

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  test('times out when the worker exits but its attached stream never completes', async () => {
    const { backend, container, demuxStream } = createHarness();
    demuxStream.mockImplementationOnce(() => undefined);

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 10,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('timed out after 10ms');
    expect(container.stop).toHaveBeenCalledWith({ t: 0 });
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  test.each([
    new Error('stream failed'),
    'stream failed',
  ])('reports attached stream failures and removes the worker', async (streamFailure) => {
    const { backend, container, demuxStream, stream } = createHarness({
      wait: () => new Promise(() => undefined),
    });
    demuxStream.mockImplementationOnce(() => {
      queueMicrotask(() => stream.emit('error', streamFailure));
    });

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('stream failed');
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  test('rejects an invalid worker exit status', async () => {
    const { backend } = createHarness({ wait: async () => ({ StatusCode: Number.NaN }) });

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['scan'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow('invalid exit status');
  });

  test('does not hide a successful result when best-effort removal fails', async () => {
    const { backend, container } = createHarness();
    container.remove.mockRejectedValueOnce(new Error('remove failed'));

    await expect(
      backend.run({
        image: PINNED_IMAGE,
        args: ['version'],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      }),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  test('inspects the pinned worker digest and OCI version', async () => {
    const { backend, inspect } = createHarness();

    await expect(backend.inspectImage(PINNED_IMAGE)).resolves.toEqual({
      image: PINNED_IMAGE,
      id: `sha256:${'b'.repeat(64)}`,
      digest: `sha256:${'a'.repeat(64)}`,
      version: '0.70.0',
    });
    expect(inspect).toHaveBeenCalledOnce();
  });

  test('falls back to the requested digest when inspect metadata has no digest or version', async () => {
    const { backend } = createHarness({ inspect: {} });

    await expect(backend.inspectImage(PINNED_IMAGE)).resolves.toEqual({
      image: PINNED_IMAGE,
      digest: `sha256:${'a'.repeat(64)}`,
    });
  });
});
