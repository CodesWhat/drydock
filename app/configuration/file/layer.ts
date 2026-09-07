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
 */

let configFileLayer: Record<string, string> = {};

/** Set by `loader.ts`'s `loadConfigFileIntoLayer` (production) or directly by tests. */
export function setConfigFileLayer(layer: Record<string, string>): void {
  configFileLayer = layer;
}

/** Read by `../index.ts` when it merges the file layer beneath the environment. */
export function getConfigFileLayer(): Record<string, string> {
  return configFileLayer;
}

/** Test-only: restores the pre-bootstrap empty layer between cases that don't `vi.resetModules()`. */
export function resetConfigFileLayer(): void {
  configFileLayer = {};
}
