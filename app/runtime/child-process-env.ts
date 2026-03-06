const BASE_ALLOWLISTED_ENV_KEYS = new Set([
  'HOME',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'LOGNAME',
  'PATH',
  'PWD',
  'SHELL',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
]);

const COMPOSE_ALLOWLISTED_ENV_KEYS = new Set([
  ...BASE_ALLOWLISTED_ENV_KEYS,
  'DOCKER_BUILDKIT',
  'DOCKER_CERT_PATH',
  'DOCKER_CONFIG',
  'DOCKER_CONTEXT',
  'DOCKER_HOST',
  'DOCKER_TLS_VERIFY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
]);

const COMPOSE_ALLOWLISTED_ENV_PREFIXES = ['COMPOSE_'];

type ChildProcessEnv = Record<string, string>;

function buildAllowlistedEnvironment(
  parentEnv: NodeJS.ProcessEnv,
  allowedKeys: ReadonlySet<string>,
  allowedPrefixes: readonly string[] = [],
): ChildProcessEnv {
  const env: ChildProcessEnv = {};

  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) {
      continue;
    }

    const hasAllowedPrefix = allowedPrefixes.some((prefix) => key.startsWith(prefix));
    if (allowedKeys.has(key) || hasAllowedPrefix) {
      env[key] = value;
    }
  }

  return env;
}

export function buildHookCommandEnvironment(
  overrides: Record<string, string> = {},
  parentEnv: NodeJS.ProcessEnv = process.env,
): ChildProcessEnv {
  return {
    ...buildAllowlistedEnvironment(parentEnv, BASE_ALLOWLISTED_ENV_KEYS),
    ...overrides,
  };
}

export function buildComposeCommandEnvironment(
  parentEnv: NodeJS.ProcessEnv = process.env,
): ChildProcessEnv {
  return buildAllowlistedEnvironment(
    parentEnv,
    COMPOSE_ALLOWLISTED_ENV_KEYS,
    COMPOSE_ALLOWLISTED_ENV_PREFIXES,
  );
}
