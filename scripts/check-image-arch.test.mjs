import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('check-image-arch.sh', import.meta.url));

const ARM64 = 'b7 00';
const AMD64 = '3e 00';
const BINARIES = ['/sbin/tini', '/usr/local/bin/node', '/bin/healthcheck'];

function probeLines(bytesByBinary) {
  // busybox `od -An` prefixes its output with a space, so the real probe emits
  // "<path> <b0> <b1>" with runs of whitespace the caller has to collapse.
  return BINARIES.map((path) => `${path}  ${bytesByBinary[path]}`).join('\n');
}

function allBinaries(bytes) {
  return probeLines(Object.fromEntries(BINARIES.map((path) => [path, bytes])));
}

/**
 * Runs the guard with a fake `docker` first on PATH that replays canned probe
 * output, so the ELF byte comparison is exercised without building an image.
 */
async function runGuard({
  probeOutput = allBinaries(ARM64),
  dockerExit = 0,
  dockerStderr = '',
  args = ['drydock:test', 'linux/arm64'],
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'drydock-image-arch-'));
  const probeFile = join(dir, 'probe-output');
  const argsLog = join(dir, 'docker-args.log');
  await writeFile(probeFile, probeOutput === '' ? '' : `${probeOutput}\n`);

  const fakeDocker = join(dir, 'docker');
  await writeFile(
    fakeDocker,
    `#!/bin/sh
printf '%s\\n' "$*" > "$DOCKER_ARGS_LOG"
if [ -n "$DOCKER_STDERR" ]; then
  printf '%s\\n' "$DOCKER_STDERR" >&2
fi
if [ "$DOCKER_EXIT" != "0" ]; then
  exit "$DOCKER_EXIT"
fi
cat "$PROBE_OUTPUT_FILE"
`,
  );
  await chmod(fakeDocker, 0o755);

  const env = {
    ...process.env,
    DOCKER_ARGS_LOG: argsLog,
    DOCKER_EXIT: String(dockerExit),
    DOCKER_STDERR: dockerStderr,
    PROBE_OUTPUT_FILE: probeFile,
    PATH: `${dir}:${process.env.PATH}`,
  };

  const readArgs = async () => {
    try {
      return await readFile(argsLog, 'utf8');
    } catch {
      return '';
    }
  };

  try {
    const { stdout, stderr } = await execFileAsync('bash', [scriptPath, ...args], { env });
    return { code: 0, output: `${stdout}${stderr}`, dockerArgs: await readArgs() };
  } catch (error) {
    return {
      code: error.code,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      dockerArgs: await readArgs(),
    };
  }
}

test('passes when every binary is aarch64 on linux/arm64', async () => {
  const result = await runGuard();

  assert.equal(result.code, 0);
  for (const path of BINARIES) {
    assert.match(result.output, new RegExp(`ok: linux/arm64 ${path} e_machine=b7 00`, 'u'));
  }
  assert.match(result.output, /All 3 binaries/u);
});

test('passes when every binary is x86-64 on linux/amd64', async () => {
  const result = await runGuard({
    probeOutput: allBinaries(AMD64),
    args: ['drydock:test', 'linux/amd64'],
  });

  assert.equal(result.code, 0);
  assert.match(result.output, /All 3 binaries in drydock:test are x86-64/u);
});

test('fails when an arm64-labelled image holds x86-64 binaries, the drydock#1021 shape', async () => {
  const result = await runGuard({ probeOutput: allBinaries(AMD64) });

  assert.equal(result.code, 1);
  assert.match(result.output, /\/sbin\/tini has e_machine=3e 00, expected b7 00/u);
  assert.match(result.output, /3 of 3 binaries have the wrong architecture/u);
  assert.match(result.output, /drydock#1021/u);
});

test('fails when a single binary is the wrong architecture', async () => {
  const result = await runGuard({
    probeOutput: probeLines({
      '/sbin/tini': ARM64,
      '/usr/local/bin/node': AMD64,
      '/bin/healthcheck': ARM64,
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.output, /1 of 3 binaries have the wrong architecture/u);
});

test('fails when a checked binary is absent from the image', async () => {
  const result = await runGuard({
    probeOutput: probeLines({
      '/sbin/tini': ARM64,
      '/usr/local/bin/node': ARM64,
      '/bin/healthcheck': 'MISSING MISSING',
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.output, /\/bin\/healthcheck is missing from the image/u);
});

test('fails when the probe returns fewer binaries than expected', async () => {
  const result = await runGuard({ probeOutput: `/sbin/tini  ${ARM64}` });

  assert.equal(result.code, 1);
  assert.match(result.output, /Expected 3 binaries in drydock:test \(linux\/arm64\), read 1/u);
});

test('fails when the probe returns nothing at all', async () => {
  const result = await runGuard({ probeOutput: '' });

  assert.equal(result.code, 1);
  assert.match(result.output, /read 0/u);
});

test('surfaces the docker error when the image cannot be run for the platform', async () => {
  const result = await runGuard({
    dockerExit: 125,
    dockerStderr: 'no matching manifest for linux/arm64',
  });

  assert.equal(result.code, 1);
  assert.match(result.output, /Could not read drydock:test as linux\/arm64/u);
  assert.match(result.output, /no matching manifest for linux\/arm64/u);
});

test('probes the image with the platform, an sh entrypoint, and od at offset 18', async () => {
  const result = await runGuard();

  assert.equal(result.code, 0);
  assert.match(
    result.dockerArgs,
    /^run --rm --platform linux\/arm64 --entrypoint sh drydock:test -c/u,
  );
  assert.match(result.dockerArgs, /od -An -tx1 -j18 -N2/u);
  for (const path of BINARIES) {
    assert.ok(result.dockerArgs.includes(path));
  }
});

test('accepts an explicit platform variant', async () => {
  const result = await runGuard({ args: ['drydock:test', 'linux/arm64/v8'] });

  assert.equal(result.code, 0);
});

test('refuses a platform whose e_machine value it does not know', async () => {
  const result = await runGuard({ args: ['drydock:test', 'linux/s390x'] });

  assert.equal(result.code, 2);
  assert.match(result.output, /Unsupported platform linux\/s390x/u);
});

test('exits 2 on a usage error', async () => {
  const result = await runGuard({ args: ['drydock:test'] });

  assert.equal(result.code, 2);
  assert.match(result.output, /Usage:/u);
});

test('ignores the pull progress docker writes to stderr', async () => {
  // docker run reports "Pulling fs layer" and friends on stderr, and a release
  // runner has never seen the image, so that is around 30 lines ahead of the
  // probe's three. Folding stderr into the parsed output made every fresh
  // runner report a bogus count.
  const result = await runGuard({
    dockerStderr: [
      "Unable to find image 'drydock:test' locally",
      'docker.io/codeswhat/drydock@sha256:abc: Pulling from codeswhat/drydock',
      '7187e76a6f79: Pulling fs layer',
      '17aac500c743: Pull complete',
      'Status: Downloaded newer image for drydock:test',
    ].join('\n'),
  });

  assert.equal(result.code, 0);
  assert.match(result.output, /All 3 binaries/u);
});

test('ignores stdout lines that are not one of the probed binaries', async () => {
  const result = await runGuard({
    probeOutput: `WARNING: something noisy\n${allBinaries(ARM64)}\n/usr/bin/env  b7 00`,
  });

  assert.equal(result.code, 0);
  assert.match(result.output, /All 3 binaries/u);
});

test('reports a probe line that carries no e_machine bytes', async () => {
  const result = await runGuard({
    probeOutput: `/sbin/tini\n/usr/local/bin/node  ${ARM64}\n/bin/healthcheck  ${ARM64}`,
  });

  assert.equal(result.code, 1);
  assert.match(result.output, /Unreadable probe output/u);
});
