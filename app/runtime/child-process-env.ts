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
  allowlistedPrefixes: readonly string[] = [],
): ChildProcessEnv {
  return {
    ...buildAllowlistedEnvironment(parentEnv, BASE_ALLOWLISTED_ENV_KEYS, allowlistedPrefixes),
    ...overrides,
  };
}
