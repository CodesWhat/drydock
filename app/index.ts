import { loadConfigFileIntoLayer } from './configuration/file/loader.js';

/**
 * Loads `drydock.yml` (if present) into `configuration/file/layer.ts` before
 * anything that transitively imports `configuration/index.ts` is evaluated.
 *
 * `./main.js` carries the real startup sequence (agent mode, the `config
 * migrate` CLI, store/registry/api init, ...) and imports
 * `configuration/index.ts` near the top of its own module graph. Importing
 * `./main.js` at the top of this file — even statically, without calling
 * anything — would let that import chain reach `configuration/index.ts`
 * before `loadConfigFileIntoLayer` runs, since import statements evaluate
 * before any of this file's own top-level code. The dynamic `import()`
 * below is what guarantees ordering: it can't start until `bootstrap()`
 * reaches it, which is after the file layer is set.
 *
 * A load failure (a missing explicit `DD_CONFIG_FILE`, invalid YAML, or a
 * group-/world-writable file) is fatal: print the loader's own message —
 * already written to name the offending path — to stderr, rather than
 * letting the rejection surface as an unhandled-rejection stack trace.
 * `process.stderr.write` runs before `log/index.ts` could: that module
 * itself imports `configuration/index.ts`, so using it here would reintroduce
 * the same ordering bug this file exists to prevent.
 *
 * This sets `process.exitCode` rather than calling `process.exit(1)`. A
 * `process.exit()` right after `stderr.write()` can truncate the message
 * when stderr is a pipe (the write is async under the hood; exit tears the
 * process down before it's guaranteed to have flushed). Setting the exit
 * code and simply returning avoids the race, and it's safe here specifically
 * because nothing on this failure path keeps the event loop alive: this
 * module never imports `./main.js` (the only thing that would), and nothing
 * else in the app imports `./index.js` (this file) — `agent/index.ts` and
 * `tag/index.ts` have same-named modules other files import, but this
 * top-level entrypoint isn't one of them. With no pending handles or timers,
 * Node exits on its own once this module finishes, after the stderr write
 * has drained.
 */
async function bootstrap(): Promise<void> {
  try {
    await loadConfigFileIntoLayer();
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  await import('./main.js');
}

await bootstrap();
