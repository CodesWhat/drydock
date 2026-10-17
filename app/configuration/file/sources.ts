/**
 * Merge a `drydock.yml` file layer beneath the real environment, and record
 * which layer supplied each key so it can be reported later (the `sources`
 * map in the future Config API, `GET /api/v1/config`).
 *
 * This is step 3 of the load order in `../index.ts`'s module doc comment: a
 * file key is copied into `ddEnvVars` unless the environment already provides
 * that setting. The whole precedence rule — env over file over Joi defaults —
 * is that one test. Defaults are never represented here: a key present in a
 * resolved section but absent from this map came from a Joi default.
 *
 * "That setting", not "that key": `DD_X` and `DD_X__FILE` are two names for
 * one setting, since `replaceSecrets` (step 4) reads the file the second one
 * points at and stores its contents under the first. A file `_file` node
 * (`DD_X__FILE`) copied in beside an environment `DD_X` would have step 4
 * overwrite the environment's value with the file's secret. So the
 * environment owns a setting when it sets either name, and the file's entry
 * for that setting is dropped whichever name it uses.
 */

export type ConfigValueSource = 'env' | 'file';

// Mirrors `VAR_FILE_SUFFIX` in `../index.ts` and `./flatten.ts`; see the
// latter's module doc comment for why each low-level module keeps its own.
const SECRET_FILE_KEY_SUFFIX = '__FILE';

/** The setting a `DD_*` name configures: `DD_X` for both `DD_X` and `DD_X__FILE`. */
export function toSettingKey(key: string): string {
  return key.endsWith(SECRET_FILE_KEY_SUFFIX) ? key.slice(0, -SECRET_FILE_KEY_SUFFIX.length) : key;
}

/** Both names one setting can arrive under: the value itself, then its secret-file form. */
export function settingKeyForms(key: string): [string, string] {
  const settingKey = toSettingKey(key);
  return [settingKey, `${settingKey}${SECRET_FILE_KEY_SUFFIX}`];
}

// Mirrors the full shape flatten.ts's toEnvKey ever produces: `DD_` plus
// uppercased, underscore-joined KEY_SEGMENT_PATTERN segments (optionally
// ending in the `__FILE` suffix, itself just more of the same charset).
// Every key ever present in `fileLayer` already satisfies this — flatten.ts
// rejects anything else before a file layer is ever built — so this is a
// sanitiser for CodeQL's js/remote-property-injection rule, not new
// validation of otherwise-unvalidated input.
const DD_ENV_KEY_PATTERN = /^DD_[A-Z0-9_]+$/;

/**
 * Mutates `envVars` in place, adding every file-supplied key whose setting
 * `envVars` doesn't already define under either of its names. `envVars` is
 * `../index.ts`'s exported `ddEnvVars` singleton, mutated in place rather
 * than replaced, exactly as the existing bootstrap loop and `replaceSecrets`
 * already mutate it — every module that imported the `ddEnvVars` binding
 * before this call sees the merged values.
 *
 * A key present in `envVars` with a value of `undefined` (rather than absent
 * entirely) is treated as unset, same as everywhere else `ddEnvVars` is read:
 * the file layer can still supply it.
 *
 * Which settings the environment owns is decided once, before any file key
 * is copied in, so one file entry can never shadow another.
 *
 * `envSourcedFileKeys` is the interpolation out-param from `loader.ts`
 * (spec-7.1-config-file.md decision D1): a file-supplied key whose value
 * came from `${NAME}` substitution attributes as `env` rather than `file`,
 * even though it physically reached `envVars` via the file layer — the
 * value itself came from the environment, and the source map is meant to
 * answer "where did this value come from", not "which layer's loader wrote
 * it".
 */
export function mergeConfigLayers(
  envVars: Record<string, string | undefined>,
  fileLayer: Record<string, string>,
  envSourcedFileKeys?: ReadonlySet<string>,
): Record<string, ConfigValueSource> {
  const sources = new Map<string, ConfigValueSource>();
  const environmentSettings = new Set<string>();

  for (const key of Object.keys(envVars)) {
    if (envVars[key] !== undefined) {
      sources.set(key, 'env');
      environmentSettings.add(toSettingKey(key));
    }
  }

  for (const [key, value] of Object.entries(fileLayer)) {
    if (!environmentSettings.has(toSettingKey(key)) && DD_ENV_KEY_PATTERN.test(key)) {
      envVars[key] = value;
      sources.set(key, envSourcedFileKeys?.has(key) ? 'env' : 'file');
    }
  }

  // Object.fromEntries builds each entry via a genuine own-property
  // assignment rather than a bracket-notation write, so this conversion —
  // like the Map itself above — doesn't read to CodeQL as the
  // remote-property-injection sink a plain `sources[key] = ...` would.
  return Object.fromEntries(sources);
}
