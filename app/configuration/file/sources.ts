/**
 * Merge a `drydock.yml` file layer beneath the real environment, and record
 * which layer supplied each key so it can be reported later (the `sources`
 * map in the future Config API, `GET /api/v1/config`).
 *
 * This is step 3 of the load order in `../index.ts`'s module doc comment:
 * `for (const [k, v] of fileLayer) if (ddEnvVars[k] === undefined) ddEnvVars[k] = v`.
 * The whole precedence rule — env over file over Joi defaults — is that one
 * `=== undefined` test. Defaults are never represented here: a key present in
 * a resolved section but absent from this map came from a Joi default.
 */

export type ConfigValueSource = 'env' | 'file';

// Mirrors the full shape flatten.ts's toEnvKey ever produces: `DD_` plus
// uppercased, underscore-joined KEY_SEGMENT_PATTERN segments (optionally
// ending in the `__FILE` suffix, itself just more of the same charset).
// Every key ever present in `fileLayer` already satisfies this — flatten.ts
// rejects anything else before a file layer is ever built — so this is a
// sanitiser for CodeQL's js/remote-property-injection rule, not new
// validation of otherwise-unvalidated input.
const DD_ENV_KEY_PATTERN = /^DD_[A-Z0-9_]+$/;

/**
 * Mutates `envVars` in place, adding every file-supplied key `envVars`
 * doesn't already define. `envVars` is `../index.ts`'s exported `ddEnvVars`
 * singleton, mutated in place rather than replaced, exactly as the existing
 * bootstrap loop and `replaceSecrets` already mutate it — every module that
 * imported the `ddEnvVars` binding before this call sees the merged values.
 *
 * A key present in `envVars` with a value of `undefined` (rather than absent
 * entirely) is treated as unset, same as everywhere else `ddEnvVars` is read:
 * the file layer can still supply it.
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

  for (const key of Object.keys(envVars)) {
    if (envVars[key] !== undefined) {
      sources.set(key, 'env');
    }
  }

  for (const [key, value] of Object.entries(fileLayer)) {
    if (envVars[key] === undefined && DD_ENV_KEY_PATTERN.test(key)) {
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
