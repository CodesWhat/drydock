/**
 * A setting and its secret-file form are one key: `DD_X` and `DD_X__FILE` in
 * the environment, `x: value` and `x: { _file: path }` in `drydock.yml`. The
 * environment wins over the file whichever form each side uses.
 *
 * Every case here starts the way the process does: a real `drydock.yml` and
 * real secret files under the OS temp dir, read by the real loader, then a
 * fresh `configuration/index.ts` merging that layer beneath the environment
 * and resolving the secret files. Only the reload a write triggers is replaced.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';

const reload = vi.hoisted(() => vi.fn());
vi.mock('./reload.js', () => ({ reloadConfiguration: reload }));

const KEY = 'DD_NOTIFICATION_DISCORD_MYHOOK_URL';
const FILE_KEY = `${KEY}__FILE`;
const ENV_LITERAL = 'https://env-literal.example/hook';
const ENV_SECRET = 'https://env-secret.example/hook';
const FILE_LITERAL = 'https://file-literal.example/hook';
const FILE_SECRET = 'https://file-secret.example/hook';
const WRITTEN_LITERAL = 'https://written-literal.example/hook';
const WRITTEN_SECRET = 'https://written-secret.example/hook';

type EnvForm = 'nothing' | 'a literal' | 'a secret file' | 'both forms';
type FileForm = 'a literal' | 'a _file node';
type Configuration = typeof import('../index.js');

let directory: string;
let configPath: string;
let envSecretPath: string;
let fileSecretPath: string;
let writtenSecretPath: string;
let missingPath: string;

function createFixtures(): void {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-secret-precedence-'));
  configPath = path.join(directory, 'drydock.yml');
  envSecretPath = path.join(directory, 'env-secret');
  fileSecretPath = path.join(directory, 'file-secret');
  writtenSecretPath = path.join(directory, 'written-secret');
  missingPath = path.join(directory, 'missing-secret');
  fs.writeFileSync(envSecretPath, `${ENV_SECRET}\n`, { mode: 0o600 });
  fs.writeFileSync(fileSecretPath, `${FILE_SECRET}\n`, { mode: 0o600 });
  fs.writeFileSync(writtenSecretPath, `${WRITTEN_SECRET}\n`, { mode: 0o600 });
}

function removeFixtures(): void {
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
}

function sectionWith(url: unknown) {
  return { discord: { myhook: { url } } };
}

function writeConfigFile(url: unknown): string {
  const text = yaml.stringify({ notification: sectionWith(url) });
  fs.writeFileSync(configPath, text, { mode: 0o600 });
  return text;
}

function stubEnvironment(envForm: EnvForm, secretPath = envSecretPath): void {
  if (envForm === 'a literal' || envForm === 'both forms') vi.stubEnv(KEY, ENV_LITERAL);
  if (envForm === 'a secret file' || envForm === 'both forms') vi.stubEnv(FILE_KEY, secretPath);
}

/**
 * The bootstrap's order: the loader fills the file layer, then
 * `configuration/index.ts` is evaluated for the first time. With no
 * `DD_CONFIG_FILE` the default paths are pointed at files that do not exist,
 * so a `/config/drydock.yml` on the machine running the suite is never read.
 */
async function boot(withConfigFile = true): Promise<Configuration> {
  if (withConfigFile) vi.stubEnv('DD_CONFIG_FILE', configPath);
  vi.resetModules();
  const { loadConfigFileIntoLayer } = await import('./loader.js');
  await loadConfigFileIntoLayer(process.env, {
    defaultPaths: [path.join(directory, 'absent.yml'), path.join(directory, 'absent.yaml')],
  });
  return import('../index.js');
}

/** Every layer `sources` names for the key, under either of its two names. */
function reportedSources(sources: Record<string, string>): string[] {
  return [...new Set([sources[KEY], sources[FILE_KEY]].filter((source) => source !== undefined))];
}

describe.each<[EnvForm, FileForm, string, 'env' | 'file']>([
  ['nothing', 'a literal', FILE_LITERAL, 'file'],
  ['nothing', 'a _file node', FILE_SECRET, 'file'],
  ['a literal', 'a literal', ENV_LITERAL, 'env'],
  ['a literal', 'a _file node', ENV_LITERAL, 'env'],
  ['a secret file', 'a literal', ENV_SECRET, 'env'],
  ['a secret file', 'a _file node', ENV_SECRET, 'env'],
  ['both forms', 'a literal', ENV_SECRET, 'env'],
  ['both forms', 'a _file node', ENV_SECRET, 'env'],
])('the environment sets %s and the file sets %s', (envForm, fileForm, value, source) => {
  let configuration: Configuration;
  let fileUrl: unknown;
  let fileText: string;

  beforeAll(async () => {
    createFixtures();
    fileUrl = fileForm === 'a literal' ? FILE_LITERAL : { _file: fileSecretPath };
    fileText = writeConfigFile(fileUrl);
    stubEnvironment(envForm);
    configuration = await boot();
  });

  afterAll(removeFixtures);

  beforeEach(() => {
    vi.clearAllMocks();
    reload.mockResolvedValue({
      applied: true,
      errors: [],
      diff: { changed: [], reload: [], restart: [] },
      reconcile: { added: [], changed: [], removed: [], unchanged: [], errors: [] },
      orphanedRules: [],
    });
  });

  afterEach(() => {
    fs.writeFileSync(configPath, fileText, { mode: 0o600 });
  });

  test(`starts with the ${source} value and reports ${source} as its source`, () => {
    expect(configuration.ddEnvVars[KEY]).toBe(value);
    expect(configuration.ddEnvVars[FILE_KEY]).toBeUndefined();
    expect(reportedSources(configuration.configFileSources)).toEqual([source]);
  });

  test('reloading the unchanged file resolves the same value and source, and changes nothing', async () => {
    const { resolveCandidateEnvAndDiff } = await import('./candidate.js');
    const { getConfigFileInterpolatedKeys, getConfigFileLayer } = await import('./layer.js');

    const candidate = await resolveCandidateEnvAndDiff(
      getConfigFileLayer(),
      getConfigFileInterpolatedKeys(),
    );

    expect(candidate.candidateEnv[KEY]).toBe(value);
    expect(candidate.candidateEnv[FILE_KEY]).toBeUndefined();
    expect(reportedSources(candidate.candidateSources)).toEqual([source]);
    expect(candidate.diff.changed).toEqual([]);
  });

  if (source === 'env') {
    test.each([
      ['a literal', () => WRITTEN_LITERAL],
      ['a _file node', () => ({ _file: writtenSecretPath })],
      ['a _file node whose path does not exist', () => ({ _file: missingPath })],
    ])(
      'refuses a write that sets %s, naming the key, and leaves the file alone',
      async (_, url) => {
        const { writeConfigurationSection } = await import('./write.js');

        const outcome = await writeConfigurationSection('notification', sectionWith(url()));

        expect(outcome).toStrictEqual({
          kind: 'env-sourced',
          section: 'notification',
          keys: [KEY],
        });
        expect(fs.readFileSync(configPath, 'utf8')).toBe(fileText);
        expect(reload).not.toHaveBeenCalled();
      },
    );
  } else {
    test.each([
      ['a literal', () => WRITTEN_LITERAL, [KEY]],
      ['a _file node', () => ({ _file: writtenSecretPath }), [KEY]],
      ['what the file already holds', () => fileUrl, []],
    ])('writes %s and reports the keys whose value changed', async (_, url, changedKeys) => {
      const { writeConfigurationSection } = await import('./write.js');

      const outcome = await writeConfigurationSection('notification', sectionWith(url()));

      expect(outcome).toMatchObject({ kind: 'written', section: 'notification', changedKeys });
      expect(yaml.parse(fs.readFileSync(configPath, 'utf8'))).toStrictEqual({
        notification: sectionWith(url()),
      });
      expect(reload).toHaveBeenCalledTimes(1);
    });
  }
});

describe('with no config file', () => {
  beforeEach(createFixtures);
  afterEach(removeFixtures);

  test.each<[EnvForm, string | undefined, string[]]>([
    ['nothing', undefined, []],
    ['a literal', ENV_LITERAL, ['env']],
    ['a secret file', ENV_SECRET, ['env']],
    ['both forms', ENV_SECRET, ['env']],
  ])('the environment setting %s resolves as it always has', async (envForm, value, sources) => {
    stubEnvironment(envForm);

    const configuration = await boot(false);

    expect(configuration.ddEnvVars[KEY]).toBe(value);
    expect(configuration.ddEnvVars[FILE_KEY]).toBeUndefined();
    expect(reportedSources(configuration.configFileSources)).toEqual(sources);
  });

  test('an environment secret file that does not exist fails the start', async () => {
    stubEnvironment('a secret file', missingPath);

    await expect(boot(false)).rejects.toThrow(
      `ENOENT: no such file or directory, open '${missingPath}'`,
    );
  });
});

describe('a secret file that does not exist', () => {
  beforeEach(createFixtures);
  afterEach(removeFixtures);

  test.each<[FileForm, () => unknown]>([
    ['a literal', () => FILE_LITERAL],
    ['a _file node', () => ({ _file: fileSecretPath })],
  ])(
    "fails the start when it is the environment's, even though the file sets %s",
    async (_, url) => {
      writeConfigFile(url());
      stubEnvironment('a secret file', missingPath);

      await expect(boot()).rejects.toThrow(
        `ENOENT: no such file or directory, open '${missingPath}'`,
      );
    },
  );

  test("fails the start when it is the file's and the environment does not set the key", async () => {
    writeConfigFile({ _file: missingPath });

    await expect(boot()).rejects.toThrow(
      `ENOENT: no such file or directory, open '${missingPath}'`,
    );
  });

  test.each<[EnvForm, string]>([
    ['a literal', ENV_LITERAL],
    ['a secret file', ENV_SECRET],
    ['both forms', ENV_SECRET],
  ])(
    "is never opened when it is the file's and the environment sets %s",
    async (envForm, value) => {
      writeConfigFile({ _file: missingPath });
      stubEnvironment(envForm);

      const configuration = await boot();

      expect(configuration.ddEnvVars[KEY]).toBe(value);
      expect(reportedSources(configuration.configFileSources)).toEqual(['env']);
    },
  );
});
