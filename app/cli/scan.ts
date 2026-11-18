import type { Container, ContainerReport } from '../model/container.js';
import * as registry from '../registry/index.js';
import * as store from '../store/index.js';
import { getErrorMessage } from '../util/error.js';

/**
 * `drydock scan` (roadmap 11.4, first slice): one fresh, observation-only
 * scan, machine output on stdout, then exit.
 *
 * Observation-only means no side effects a daemon would have: the store is
 * in memory (nothing is read from or written to the data volume), only
 * registries and watchers are registered (no triggers, so nothing can notify
 * or act; no authentications, no API listener, no agents), and the Docker
 * watcher registers without its cron, startup scan and events stream (see
 * `runtime/observation-mode.ts`). Logs go to stderr, so stdout carries the
 * chosen output and nothing else. Watchers and registries are torn down and
 * the timeout timer is cleared before returning, so the process exits on its
 * own.
 *
 * Exit codes:
 *   0  scan complete, no updates available
 *   1  technical failure (Docker or registry error, no watcher registered,
 *      store failure). Takes priority over 3: an incomplete scan cannot vouch
 *      for the absence of updates, nor for a complete list of them.
 *   2  usage error
 *   3  scan complete, at least one update available
 *   4  the --timeout elapsed before the scan finished
 */
const SCAN_EXIT_OK = 0;
const SCAN_EXIT_FAILURE = 1;
const SCAN_EXIT_USAGE = 2;
const SCAN_EXIT_UPDATES = 3;
export const SCAN_EXIT_TIMEOUT = 4;

const DEFAULT_TIMEOUT_SECONDS = 300;
const SCHEMA_VERSION = 1;

type ScanFormat = 'json' | 'ndjson';
type ScanStatus = 'ok' | 'updates' | 'error' | 'timeout';

interface ScanCliIo {
  out(message: string): void;
  err(message: string): void;
}

export interface RunScanCliOptions {
  io?: ScanCliIo;
  now?: () => Date;
}

interface ScanCliOptions {
  format: ScanFormat;
  updatesOnly: boolean;
  timeoutSeconds: number;
  help: boolean;
}

type ParseResult = { kind: 'ok'; options: ScanCliOptions } | { kind: 'error'; error: string };

interface ScanWatcher {
  name: string;
  watch(): Promise<ContainerReport[]>;
  lastScanIncomplete?: boolean;
}

interface ScanContainerRecord {
  watcher: string;
  name: string;
  id: string;
  status: string;
  image: { registry: string; name: string; tag: string };
  updateAvailable: boolean;
  updateKind: {
    kind: string;
    semverDiff: string | null;
    local: string | null;
    remote: string | null;
  };
  result: { tag: string | null; digest: string | null };
  error: string | null;
}

// Flags that would turn a scan into something that changes state. They are
// refused by name so the message says why, instead of "unknown argument".
const REFUSED_FLAGS = new Set([
  '--notify',
  '--notifications',
  '--trigger',
  '--action',
  '--update',
  '--apply',
]);

function parseOptions(args: string[]): ParseResult {
  const options: ScanCliOptions = {
    format: 'json',
    updatesOnly: false,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--updates-only') {
      options.updatesOnly = true;
    } else if (arg === '--format') {
      const value = args[index + 1];
      if (value !== 'json' && value !== 'ndjson') {
        return { kind: 'error', error: '--format requires "json" or "ndjson"' };
      }
      options.format = value;
      index += 1;
    } else if (arg === '--timeout') {
      const value = args[index + 1];
      if (!value || !/^[1-9]\d*$/.test(value)) {
        return { kind: 'error', error: '--timeout requires a whole number of seconds (1 or more)' };
      }
      options.timeoutSeconds = Number(value);
      index += 1;
    } else if (REFUSED_FLAGS.has(arg)) {
      return {
        kind: 'error',
        error: `${arg} is not supported: scan is observation-only and never notifies or updates`,
      };
    } else {
      return { kind: 'error', error: `Unknown argument: ${arg}` };
    }
  }

  return { kind: 'ok', options };
}

function printHelp(io: ScanCliIo): void {
  io.out(
    'Usage: node dist/index.js scan [--format json|ndjson] [--updates-only] [--timeout <seconds>]',
  );
  io.out('');
  io.out('Runs one fresh scan of the configured watchers, prints the result to stdout and');
  io.out('exits. Observation only: no API listener, no store writes, no notifications,');
  io.out('no updates. Logs go to stderr.');
  io.out('');
  io.out('Options:');
  io.out('  --format <fmt>      json (one document, default) or ndjson (one line per container)');
  io.out('  --updates-only      Only list containers with an update available');
  io.out(`  --timeout <secs>    Give up after this long (default ${DEFAULT_TIMEOUT_SECONDS})`);
  io.out('  --help              Show this help');
  io.out('');
  io.out('Exit codes: 0 no updates, 1 failure, 2 usage error, 3 updates found, 4 timeout');
}

function nullable(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

function toRecord(container: Container): ScanContainerRecord {
  const updateKind = container.updateKind;
  return {
    watcher: container.watcher,
    name: container.name,
    id: container.id,
    status: container.status,
    image: {
      registry: container.image.registry.name,
      name: container.image.name,
      tag: container.image.tag.value,
    },
    updateAvailable: container.updateAvailable === true,
    updateKind: {
      kind: updateKind?.kind ?? 'unknown',
      semverDiff: nullable(updateKind?.semverDiff),
      local: nullable(updateKind?.localValue),
      remote: nullable(updateKind?.remoteValue),
    },
    result: {
      tag: nullable(container.result?.tag),
      digest: nullable(container.result?.digest),
    },
    error: container.error?.message ?? null,
  };
}

// Plain code-unit order, not localeCompare, so the order never depends on the
// machine's locale.
function compareStrings(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}

function compareRecords(a: ScanContainerRecord, b: ScanContainerRecord): number {
  return compareStrings(a.watcher, b.watcher) || compareStrings(a.name, b.name);
}

type ScanOutcome =
  | { kind: 'done'; records: ScanContainerRecord[]; errors: string[] }
  | { kind: 'timeout' };

async function scanWatchers(watchers: ScanWatcher[]): Promise<ScanOutcome> {
  const settled = await Promise.allSettled(watchers.map((watcher) => watcher.watch()));
  const records: ScanContainerRecord[] = [];
  const errors: string[] = [];
  settled.forEach((result, index) => {
    const watcher = watchers[index];
    if (result.status === 'rejected') {
      errors.push(`watcher ${watcher.name}: ${getErrorMessage(result.reason)}`);
      return;
    }
    if (watcher.lastScanIncomplete) {
      errors.push(
        `watcher ${watcher.name}: the container list was incomplete (see the logs on stderr)`,
      );
    }
    for (const report of result.value) {
      records.push(toRecord(report.container));
    }
  });
  return { kind: 'done', records, errors };
}

async function scanWithTimeout(
  watchers: ScanWatcher[],
  timeoutSeconds: number,
): Promise<ScanOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ScanOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutSeconds * 1000);
  });
  try {
    return await Promise.race([scanWatchers(watchers), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function writeOutput(
  io: ScanCliIo,
  options: ScanCliOptions,
  status: ScanStatus,
  records: ScanContainerRecord[],
  errors: string[],
  scannedAt: string,
): void {
  const listed = options.updatesOnly ? records.filter((record) => record.updateAvailable) : records;
  if (options.format === 'ndjson') {
    for (const record of listed) {
      io.out(JSON.stringify(record));
    }
    return;
  }
  io.out(
    JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        status,
        scannedAt,
        summary: {
          scanned: records.length,
          updates: records.filter((record) => record.updateAvailable).length,
          errors: records.filter((record) => record.error !== null).length + errors.length,
        },
        containers: listed,
        errors,
      },
      null,
      2,
    ),
  );
}

export async function runScanCommand(
  args: string[],
  runOptions: RunScanCliOptions = {},
): Promise<number> {
  const io: ScanCliIo = runOptions.io ?? {
    out: (message) => process.stdout.write(`${message}\n`),
    err: (message) => process.stderr.write(`${message}\n`),
  };
  const now = runOptions.now ?? (() => new Date());

  const parsed = parseOptions(args);
  if (parsed.kind === 'error') {
    io.err(`Error: ${parsed.error}`);
    printHelp(io);
    return SCAN_EXIT_USAGE;
  }
  const { options } = parsed;
  if (options.help) {
    printHelp(io);
    return SCAN_EXIT_OK;
  }

  try {
    await store.init({ memory: true });
    await registry.initObservationOnly();
    const watchers = Object.values(registry.getState().watcher) as unknown as ScanWatcher[];
    if (watchers.length === 0) {
      io.err('Error: no watcher is registered, so there is nothing to scan');
      return SCAN_EXIT_FAILURE;
    }

    const scannedAt = now().toISOString();
    const outcome = await scanWithTimeout(watchers, options.timeoutSeconds);
    if (outcome.kind === 'timeout') {
      const message = `the scan did not finish within ${options.timeoutSeconds} seconds`;
      io.err(`Error: ${message}`);
      writeOutput(io, options, 'timeout', [], [message], scannedAt);
      return SCAN_EXIT_TIMEOUT;
    }

    const records = outcome.records.sort(compareRecords);
    const failed = outcome.errors.length > 0 || records.some((record) => record.error !== null);
    const hasUpdates = records.some((record) => record.updateAvailable);
    let status: ScanStatus = 'ok';
    if (failed) {
      status = 'error';
    } else if (hasUpdates) {
      status = 'updates';
    }
    for (const message of outcome.errors) {
      io.err(`Error: ${message}`);
    }
    writeOutput(io, options, status, records, outcome.errors, scannedAt);

    if (failed) {
      return SCAN_EXIT_FAILURE;
    }
    return hasUpdates ? SCAN_EXIT_UPDATES : SCAN_EXIT_OK;
  } catch (error) {
    io.err(`Error: ${getErrorMessage(error)}`);
    return SCAN_EXIT_FAILURE;
  } finally {
    await registry.deregisterObservationOnly();
  }
}
