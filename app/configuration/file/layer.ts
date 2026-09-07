/**
 * Pure in-memory home for the file layer `file/loader.ts` produces.
 *
 * `loader.ts`'s `stat`/`readFile` calls used to run inside `../index.ts`'s
 * own top-level await, meaning they ran whenever ANY module imported
 * configuration — nearly every test file, since `configuration/index.ts` is
 * imported almost everywhere. `app/index.ts`'s bootstrap now calls
 * `loader.ts`'s `loadConfigFileIntoLayer()`, which populates this module via
 * `setConfigFileLayer`, before dynamically importing `./main.js` — the only
 * thing that transitively imports `../index.ts` in production. `../index.ts`
 * itself imports only this module (never `loader.ts`), so importing it never
 * touches `fs`. Tests that want a specific file layer call
 * `setConfigFileLayer` directly instead of writing real files and setting
 * `DD_CONFIG_FILE`.
 *
 * `interpolatedKeys` travels alongside the layer for the same reason
 * (roadmap 7.1 slice 1b, decision D1): a key whose file value came from
 * `${NAME}` substitution attributes as source `env`, not `file`, once
 * `../index.ts` merges it — `getConfigFileInterpolatedKeys()` is how that
 * merge finds out which keys those were, without `../index.ts` needing to
 * import `loader.ts` (or `interpolate.ts`) itself.
 */

let configFileLayer: Record<string, string> = {};
let configFileInterpolatedKeys: ReadonlySet<string> = new Set();

/** Set by `loader.ts`'s `loadConfigFileIntoLayer` (production) or directly by tests. */
export function setConfigFileLayer(
  layer: Record<string, string>,
  interpolatedKeys: ReadonlySet<string> = new Set(),
): void {
  configFileLayer = layer;
  configFileInterpolatedKeys = interpolatedKeys;
}

/** Read by `../index.ts` when it merges the file layer beneath the environment. */
export function getConfigFileLayer(): Record<string, string> {
  return configFileLayer;
}

/** Read by `../index.ts` so an interpolated key can attribute as `env`. */
export function getConfigFileInterpolatedKeys(): ReadonlySet<string> {
  return configFileInterpolatedKeys;
}

/** Test-only: restores the pre-bootstrap empty layer between cases that don't `vi.resetModules()`. */
export function resetConfigFileLayer(): void {
  configFileLayer = {};
  configFileInterpolatedKeys = new Set();
}
