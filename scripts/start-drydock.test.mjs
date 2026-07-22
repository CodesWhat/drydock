import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('start-drydock.sh', import.meta.url));
const coreFixturesPath = fileURLToPath(
  new URL('../e2e/config/cucumber-core-fixtures.txt', import.meta.url),
);
const apiContainerFeaturePath = fileURLToPath(
  new URL('../e2e/features/api-container.feature', import.meta.url),
);
const startScriptSource = await readFile(scriptPath, 'utf8');

async function makeExecutable(path, source) {
  await writeFile(path, source);
  await chmod(path, 0o755);
}

const readyFixture = (name) => ({
  name,
  image: {
    name: `fixtures/${name}`,
    registry: { name: 'test.registry', url: 'https://registry.example.test/v2' },
    tag: { value: '1.0.0' },
  },
});

const coreFixtureNames = (await readFile(coreFixturesPath, 'utf8'))
  .split('\n')
  .map((name) => name.trim())
  .filter(Boolean);
const defaultFixtures = coreFixtureNames.map(readyFixture);

async function runStartScript({
  containers = defaultFixtures,
  githubUsername = '',
  gitlabToken = '',
  healthMode = 'healthy',
  requiredFixturesSource,
  skipBuild = false,
} = {}) {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'drydock-start-test-'));
  const dockerLog = join(fixtureDir, 'docker.log');
  const githubOutput = join(fixtureDir, 'github-output');
  const containersResponse = join(fixtureDir, 'containers.json');
  const curlLog = join(fixtureDir, 'curl.log');
  const requiredFixturesFile = join(fixtureDir, 'required-fixtures.txt');
  await writeFile(containersResponse, JSON.stringify({ data: containers }));
  if (requiredFixturesSource !== undefined) {
    await writeFile(requiredFixturesFile, requiredFixturesSource);
  }

  await makeExecutable(
    join(fixtureDir, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_TEST_LOG"
if [ "$1" = "port" ]; then
  printf '0.0.0.0:41234\\n'
fi
exit 0
`,
  );
  await makeExecutable(
    join(fixtureDir, 'curl'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$CURL_TEST_LOG"
case "$*" in
  *'/health'*)
    if [ "$HEALTH_MODE" = "http-503" ]; then
      case "$*" in
        *-f*) exit 22 ;;
        *) exit 0 ;;
      esac
    fi
    exit 0
    ;;
  *) command cat "$CONTAINERS_RESPONSE" ;;
esac
`,
  );
  await makeExecutable(join(fixtureDir, 'sleep'), '#!/bin/sh\nexit 0\n');

  let result;
  try {
    const execution = await execFileAsync('bash', [scriptPath], {
      env: {
        ...process.env,
        DD_E2E_IMAGE: 'drydock:dev',
        DD_E2E_REQUIRED_FIXTURES_FILE:
          requiredFixturesSource === undefined ? '' : requiredFixturesFile,
        DD_PORT: '41234',
        DD_E2E_SKIP_BUILD: skipBuild ? 'true' : 'false',
        CONTAINERS_RESPONSE: containersResponse,
        CURL_TEST_LOG: curlLog,
        DOCKER_TEST_LOG: dockerLog,
        GITHUB_TOKEN: githubUsername ? 'github-test-token' : '',
        GITHUB_USERNAME: githubUsername,
        GITHUB_OUTPUT: githubOutput,
        GITLAB_TOKEN: gitlabToken,
        HEALTH_MODE: healthMode,
        PATH: `${fixtureDir}:${process.env.PATH}`,
      },
    });
    result = { ...execution, exitCode: 0 };
  } catch (error) {
    result = {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.code,
    };
  }

  return {
    ...result,
    curlCalls: await readFile(curlLog, 'utf8'),
    dockerCalls: await readFile(dockerLog, 'utf8'),
  };
}

test('core readiness manifest matches the active public fixture contract', async () => {
  const feature = await readFile(apiContainerFeaturePath, 'utf8');
  const untaggedFeature = feature.split(/\n\s+@requires_gitlab\b/u, 1)[0];
  const activeFixtureNames = untaggedFeature
    .split('\n')
    .filter((line) => /^\s+\|\s+[^|]+\.(public|private)\s+\|/u.test(line))
    .map((line) => line.split('|')[2].trim());

  assert.deepEqual(coreFixtureNames, activeFixtureNames);
  assert.match(feature, new RegExp(`minimum length ${coreFixtureNames.length}\\b`, 'u'));
});

test('test registry placeholders do not embed a PEM-shaped private key', async () => {
  const keyKind = 'PRIVATE KEY';
  const beginMarker = `-----BEGIN ${keyKind}-----`;
  const endMarker = `-----END ${keyKind}-----`;
  assert.doesNotMatch(startScriptSource, new RegExp(beginMarker, 'u'));

  const result = await runStartScript();
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  assert.ok(
    result.dockerCalls.includes(
      `DD_REGISTRY_GCR_PRIVATE_PRIVATEKEY=${beginMarker}\\nnot-a-real-key\\n${endMarker}`,
    ),
  );
});

test('prebuilt-image mode starts the requested image without rebuilding source', async () => {
  const result = await runStartScript({ skipBuild: true });

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.dockerCalls, /^build /mu);
  assert.match(result.dockerCalls, /^image inspect drydock:dev$/mu);
  assert.match(result.dockerCalls, / drydock:dev$/mu);
});

test('health readiness rejects an HTTP 503 response', async () => {
  const result = await runStartScript({ healthMode: 'http-503' });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /failed to become healthy/u);
  assert.doesNotMatch(result.stdout, /drydock is healthy/u);
});

test('fixture readiness rejects an aggregate count made up by the wrong container', async () => {
  const containers = defaultFixtures.map((fixture) =>
    fixture.name === 'hub_nginx_120' ? readyFixture('unrelated_qa_container') : fixture,
  );

  const result = await runStartScript({ containers });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /missing required fixtures: hub_nginx_120/u);
  assert.doesNotMatch(result.stdout, /Ready for e2e tests!/u);
});

test('fixture readiness reports the exact unresolved image fields', async () => {
  const containers = [
    ...defaultFixtures.map((fixture) =>
      fixture.name === 'hub_nginx_120'
        ? {
            ...fixture,
            image: { ...fixture.image, tag: { value: '' } },
          }
        : fixture,
    ),
    readyFixture('unrelated_qa_container'),
  ];

  const result = await runStartScript({ containers });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /unresolved required fixtures: hub_nginx_120 \(image\.tag\.value\)/u);
});

test('fixture readiness waits for the registry URL used by API assertions', async () => {
  const containers = [
    ...defaultFixtures.map((fixture) =>
      fixture.name === 'quay_prometheus'
        ? {
            ...fixture,
            image: { ...fixture.image, registry: { ...fixture.image.registry, url: '' } },
          }
        : fixture,
    ),
    readyFixture('unrelated_qa_container'),
  ];

  const result = await runStartScript({ containers });

  assert.notEqual(result.exitCode, 0);
  assert.match(
    result.stdout,
    /unresolved required fixtures: quay_prometheus \(image\.registry\.url\)/u,
  );
});

test('fixture readiness requires credential-gated fixtures only when enabled', async () => {
  const result = await runStartScript({
    githubUsername: 'ci-user',
    gitlabToken: 'gitlab-test-token',
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /missing required fixtures: gitlab_test/u);
  assert.doesNotMatch(result.stdout, /ghcr_radarr|lscr_radarr/u);
});

test('fixture readiness does not gate providers absent from the active Cucumber contract', async () => {
  const containers = [
    ...defaultFixtures,
    readyFixture('ecr_sub_sub_test'),
    readyFixture('trueforge_radarr'),
  ];

  const result = await runStartScript({ containers });

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /resolved all 6 required fixtures/u);
});

test('fixture readiness queries the versioned containers endpoint', async () => {
  const result = await runStartScript();

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  assert.match(result.curlCalls, /\/api\/v1\/containers/u);
});

test('fixture readiness rejects a comment-only override manifest', async () => {
  const result = await runStartScript({ requiredFixturesSource: '# no fixtures\n' });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /manifest contains no required fixtures/u);
});
