import { logError, logWarn } from '../../log/warn.js';
import { getErrorMessage } from '../../util/error.js';
import { getConfigFileInfo } from './layer.js';
import { type ConfigurationReloadResult, reloadConfiguration } from './reload.js';

/**
 * `DD_CONFIG_WATCH`'s engine (roadmap 7.1 slice 6, spec-7.1-config-file.md
 * section 4.3, decision D2): watch the file `../index.ts` loaded at boot and
 * call `reloadConfiguration()` whenever it changes.
 *
 * The `DD_CONFIG_WATCH` gate itself lives in the caller (`main.ts`), not
 * here — `startConfigFileWatch` never reads `process.env` on its own, so it
 * stays a pure, fully-testable state machine rather than a second place that
 * has to agree with `main.ts` about the flag's name or its default.
 *
 * `fs.watch` is dynamically imported inside this function, never at module
 * load: every other module under `configuration/` performs no filesystem I/O
 * just by being imported, and this one is no exception.
 */

export interface ConfigFileWatchHandle {
  close(): void;
}

export interface StartConfigFileWatchOptions {
  /** Test seam: which path to watch, in place of the file discovered at boot. */
  filePath?: string;
  /** Test seam: replaces the real `reloadConfiguration` call. */
  reload?: () => Promise<ConfigurationReloadResult>;
  /**
   * Debounce window, in ms: coalesces a burst of `fs.watch` events (an
   * editor's write-then-truncate save pattern produces more than one) into a
   * single reload rather than one per event.
   */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Returns `undefined`, touching no filesystem API at all, when there is no
 * file to watch — nothing was discovered at boot, so there is nothing this
 * function could attach a watch to; a `drydock.yml` added afterward is only
 * picked up by the next restart, the same as it always was before this
 * feature existed.
 */
export async function startConfigFileWatch(
  options: StartConfigFileWatchOptions = {},
): Promise<ConfigFileWatchHandle | undefined> {
  const filePath = options.filePath ?? getConfigFileInfo()?.path;
  if (!filePath) {
    return undefined;
  }

  const doReload = options.reload ?? reloadConfiguration;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let reloadInFlight = false;

  function runReload(): void {
    reloadInFlight = true;
    doReload()
      .then((result) => {
        if (!result.applied) {
          logWarn(`Config file change ignored: reload refused (${result.errors.length} error(s))`);
        }
      })
      .catch((error: unknown) => {
        // Never crash the process over a bad edit: a broken drydock.yml is
        // refused, not fatal, when POST /api/v1/config/reload hits it, and
        // that same guarantee has to hold for a reload this module triggers
        // on its own, with no HTTP response to carry the failure back to.
        logError(`Config file watch reload failed: ${getErrorMessage(error)}`);
      })
      .finally(() => {
        reloadInFlight = false;
      });
  }

  function onFileEvent(): void {
    // Ignore a change signal that arrives while a reload is already in
    // flight, rather than queueing it: the in-flight reload rereads
    // whatever is on disk right now, and a file that changes again once it
    // finishes fires its own, later event.
    if (reloadInFlight) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      runReload();
    }, debounceMs);
    debounceTimer.unref();
  }

  const { watch } = await import('node:fs');
  const watcher = watch(filePath, () => {
    onFileEvent();
  });
  watcher.on('error', (error: unknown) => {
    // An EventEmitter with no 'error' listener throws on emit — attaching
    // one, even just to log, is what keeps a watch failure (the file's
    // directory disappearing, an ENOENT after a rename-based save) from
    // crashing the whole process.
    logError(`Config file watch failed: ${getErrorMessage(error)}`);
  });
  watcher.unref();

  return {
    close(): void {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      watcher.close();
    },
  };
}
