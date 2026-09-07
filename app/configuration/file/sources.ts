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
  const sources: Record<string, ConfigValueSource> = {};

  for (const key of Object.keys(envVars)) {
    if (envVars[key] !== undefined) {
      sources[key] = 'env';
    }
  }

  for (const [key, value] of Object.entries(fileLayer)) {
    if (envVars[key] === undefined) {
      envVars[key] = value;
      sources[key] = envSourcedFileKeys?.has(key) ? 'env' : 'file';
    }
  }

  return sources;
}
