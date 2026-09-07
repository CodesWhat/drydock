import { basename, dirname } from 'node:path';
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
 * just by being imported, and this one is no exception. `node:path` is a
 * pure, I/O-free import and stays static.
 *
 * Watches the file's *directory*, not the file itself: `write.ts` (and any
 * editor) saves by writing a sibling temp file and renaming it over the
 * target, which — per Node's own `fs.watch` docs — replaces the inode a
 * direct watch on the file path is attached to, so that watch goes dead
 * after the very first atomic save. Watching the directory survives that,
 * at the cost of also seeing events for every other file in it, so the
 * callback below filters to the one basename this module cares about.
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
  let reloadQueued = false;
  let closed = false;

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
        // A change signal that arrived while this reload was in flight was
        // queued, not dropped: the in-flight reload could only ever reread
        // whatever was on disk when it started, so a queued signal means the
        // file may already differ from what that reload just applied — run
        // the (debounced) sequence again now rather than depending on some
        // later, unrelated event to notice.
        if (reloadQueued && !closed) {
          reloadQueued = false;
          onFileEvent();
        }
      });
  }

  function onFileEvent(): void {
    // A change signal that arrives while a reload is already in flight is
    // queued rather than acted on immediately: the in-flight reload rereads
    // whatever is on disk right now, so running a second one concurrently
    // would just re-read the same content. Exactly one more reload runs once
    // it settles (see the `.finally()` above), coalescing however many
    // events arrived during the in-flight reload into that single follow-up.
    if (reloadInFlight) {
      reloadQueued = true;
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

  const targetBasename = basename(filePath);
  const watchDir = dirname(filePath);

  const { watch } = await import('node:fs');
  let watcher: ReturnType<typeof watch>;
  try {
    watcher = watch(watchDir, (_eventType, filename) => {
      // `filename` may be a Buffer (a platform whose native encoding isn't
      // representable as a JS string) or `null` (some platforms don't
      // supply it at all, per Node's own fs.watch docs) — treat `null` as a
      // match rather than filtering it out, since silently dropping every
      // event a platform declines to name would be worse than an occasional
      // extra reload triggered by another file in the same directory.
      const changedName = filename === null ? null : filename.toString();
      if (changedName !== null && changedName !== targetBasename) {
        return;
      }
      onFileEvent();
    });
  } catch (error) {
    logError(`Config file watch could not start: ${getErrorMessage(error)}`);
    return undefined;
  }
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
      closed = true;
      reloadQueued = false;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      watcher.close();
    },
  };
}
