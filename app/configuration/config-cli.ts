import { writeFile } from 'node:fs/promises';
import yaml, { type Document } from 'yaml';
import { REDACTED_VALUE, redactDebugDump } from '../debug/redact.js';
import { resolveConfiguredPath } from '../runtime/paths.js';
import { getErrorMessage } from '../util/error.js';
import { loadConfigFile } from './file/loader.js';
import { mergeConfigLayers } from './file/sources.js';
import { validateConfiguration } from './file/validate.js';
import { isConfigSubcommand, type MigrateCliIo, resolveCliIo } from './migrate-cli.js';

/**
 * `drydock config validate` and `drydock config export` (roadmap 7.1 slice 3,
 * spec-7.1-config-file.md section 6). Both reuse `loadConfigFile` (slice 1)
 * and `validateConfiguration` (slice 2) rather than a second implementation —
 * `validate`'s whole job is calling them and formatting what comes back.
 *
 * `runConfigCommandIfRequested` (this module's one export besides the two
 * command functions main.ts's own dispatcher never needed) is called from
 * `app/index.ts`, *before* that bootstrap's own `loadConfigFileIntoLayer()`
 * call, for `validate` and `export` only. That's the load-order fix this
 * slice exists to make: `app/index.ts`'s existing bootstrap treats any file
 * load failure as fatal — print the loader's message, `process.exit(1)` —
 * which is correct for starting the real server but wrong for `config
 * validate`, whose entire purpose is to *diagnose* exactly that kind of
 * failure without the process dying before it can print its own, more
 * specific report (and, for `--file`, validate a candidate that was never
 * going to be the auto-discovered file in the first place). Dispatching
 * before the load sidesteps the bootstrap's crash-and-exit path entirely:
 * neither command depends on `file/layer.ts`'s module-level state, each
 * builds its own candidate env from `loadConfigFile` directly.
 *
 * `config migrate` is deliberately NOT routed through this function. It
 * doesn't touch `drydock.yml` at all, so it keeps its existing dispatch site
 * (`main.ts`, after the file layer loads) and its existing, separately
 * pinned behaviour (`migrate-cli.ts`, `migrate-cli.test.ts`) untouched. This
 * function returns `null` for it, the same "not mine, let something else
 * decide" signal `isConfigMigrateCommand` already used before this slice.
 */

export interface RunConfigCliOptions {
  cwd?: string;
  io?: MigrateCliIo;
  env?: Record<string, string | undefined>;
}

type ParseOptionsResult<T> = { kind: 'ok'; options: T } | { kind: 'error'; error: string };

// Mirrors `VAR_FILE_SUFFIX` in `../index.ts` and `file/flatten.ts`. Kept in
// sync by hand, same reasoning those two already give for their own copies:
// this is a CLI-only concern, not worth a shared import across the loader
// stack for one constant.
const SECRET_FILE_KEY_SUFFIX = '__FILE';

// -----------------------------------------------------------------------
// config validate
// -----------------------------------------------------------------------

interface ValidateCliOptions {
  file?: string;
  help: boolean;
}

function parseValidateOptions(args: string[]): ParseOptionsResult<ValidateCliOptions> {
  const options: ValidateCliOptions = { help: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--file') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        return { kind: 'error', error: '--file requires a path value' };
      }
      options.file = value;
      index += 1;
      continue;
    }
    return { kind: 'error', error: `Unknown argument: ${arg}` };
  }

  return { kind: 'ok', options };
}

function printValidateHelp(io: MigrateCliIo): void {
  io.out('Usage: node dist/index.js config validate [--file <path>]');
  io.out('');
  io.out('Loads and validates a drydock.yml against every component schema, without');
  io.out('starting anything (no Docker socket, store, or network required).');
  io.out('');
  io.out('Options:');
  io.out('  --file <path>   Validate a specific file instead of the discovered one');
  io.out('  --help          Show this help');
}

// A fixed, non-empty sentinel standing in for a `_file`-backed secret's
// resolved value. `validateConfiguration` is a pure function of the
// candidate env map — resolving a real `_file`/`__FILE` reference is
// `replaceSecrets`'s job, and `replaceSecrets` genuinely opens the
// referenced file. Running it here would mean `config validate` (and, in
// particular, `drydock.example.yml`'s own "parses and validates" test) could
// only pass on a machine that has the operator's real secret files mounted —
// exactly what "usable as a CI check on a committed drydock.yml"
// (spec-7.1-config-file.md section 6) rules out. This stands in for it with
// a fixed placeholder that matches only the *shape* `replaceSecrets`
// produces (the `__FILE` key gone, the base key set to a non-empty string),
// so a Joi `.required()` on the base field sees it as present, without this
// module ever touching the filesystem for a secret's contents.
const SECRET_PLACEHOLDER_VALUE =
  '(value would be read from the referenced _file at real startup; config validate does not read it)';

function resolveSecretPlaceholders(candidateEnv: Record<string, string | undefined>): void {
  for (const key of Object.keys(candidateEnv)) {
    if (!key.endsWith(SECRET_FILE_KEY_SUFFIX)) {
      continue;
    }
    const baseKey = key.slice(0, -SECRET_FILE_KEY_SUFFIX.length);
    if (candidateEnv[baseKey] === undefined) {
      candidateEnv[baseKey] = SECRET_PLACEHOLDER_VALUE;
    }
    delete candidateEnv[key];
  }
}

/**
 * Load `filePathOverride` (via `--file`, forced through as a `DD_CONFIG_FILE`
 * override so the same discovery/parse/interpolate/flatten hardening
 * `loadConfigFile` already does applies unchanged) or, when omitted, the
 * ordinary default-discovery file, then merge it beneath `env` the same way
 * `../index.ts`'s real bootstrap does (`mergeConfigLayers`, env wins).
 */
async function buildValidationCandidate(
  env: Record<string, string | undefined>,
  filePathOverride: string | undefined,
): Promise<Record<string, string | undefined>> {
  const loadEnv =
    filePathOverride === undefined ? env : { ...env, DD_CONFIG_FILE: filePathOverride };
  const fileLayer = await loadConfigFile(loadEnv);
  const candidateEnv: Record<string, string | undefined> = { ...env };
  mergeConfigLayers(candidateEnv, fileLayer);
  resolveSecretPlaceholders(candidateEnv);
  return candidateEnv;
}

async function runConfigValidateCommand(
  argv: string[],
  options: RunConfigCliOptions,
): Promise<number> {
  const io = resolveCliIo(options.io);
  const parsed = parseValidateOptions(argv.slice(2));
  if (parsed.kind === 'error') {
    io.err(`Error: ${parsed.error}`);
    printValidateHelp(io);
    return 2;
  }
  if (parsed.options.help) {
    printValidateHelp(io);
    return 0;
  }

  const env = options.env ?? process.env;
  let candidateEnv: Record<string, string | undefined>;
  try {
    candidateEnv = await buildValidationCandidate(env, parsed.options.file);
  } catch (error) {
    io.err(getErrorMessage(error));
    return 1;
  }

  const result = await validateConfiguration(candidateEnv);
  if (result.errors.length > 0) {
    for (const validationError of result.errors) {
      io.err(`${validationError.path}: ${validationError.message}`);
    }
    return 1;
  }

  io.out('Configuration is valid.');
  return 0;
}

// -----------------------------------------------------------------------
// config export
// -----------------------------------------------------------------------

interface ExportCliOptions {
  out?: string;
  help: boolean;
}

function parseExportOptions(args: string[]): ParseOptionsResult<ExportCliOptions> {
  const options: ExportCliOptions = { help: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        return { kind: 'error', error: '--out requires a path value' };
      }
      options.out = value;
      index += 1;
      continue;
    }
    return { kind: 'error', error: `Unknown argument: ${arg}` };
  }

  return { kind: 'ok', options };
}

function printExportHelp(io: MigrateCliIo): void {
  io.out('Usage: node dist/index.js config export [--out <path>]');
  io.out('');
  io.out('Writes the current DD_* environment as a drydock.yml. Secret values are');
  io.out('replaced with a "_file" stub — never inlined — for the operator to point at');
  io.out('a real secret file. Prints to stdout unless --out is given.');
  io.out('');
  io.out('Options:');
  io.out('  --out <path>    Write to a file instead of stdout');
  io.out('  --help          Show this help');
}

const SECRET_PLACEHOLDER_PATH = '/path/to/secret/file';
const SECRET_PLACEHOLDER_COMMENT =
  ' TODO: point this at a file containing the real secret value, then remove this comment';

function isDdEnvKey(key: string): boolean {
  return key.toUpperCase().startsWith('DD_');
}

// The inverse of flatten.ts's toEnvKey: every underscore-delimited segment
// becomes one nesting level. This is deliberately the *maximal* split, not
// an attempt to recover whichever nesting the operator originally wrote —
// section 2.1 of the spec documents that the two are genuinely
// indistinguishable from the env key alone. Any nesting that flattens back
// to the same key is a valid export; this is just the simplest one to build.
function envKeyToPathSegments(envKey: string): string[] {
  return envKey
    .slice(3)
    .split('_')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

/**
 * Whether `envKey` names a credential, using the exact rules
 * `GET /api/v1/config` will apply (roadmap 7.1 slice 4) via
 * `redactDebugDump` — probed with a synthetic, non-secret value rather than
 * duplicating `app/debug/redact.ts`'s private key-name lists here. `redact.ts`
 * only exports the whole-payload transform, not the per-key predicate, so
 * this asks it "would you redact a key named this?" instead of re-deriving
 * the same answer from a second copy of its rules.
 */
function isSensitiveEnvKey(envKey: string): boolean {
  const probe = redactDebugDump({ [envKey]: 'x' }) as Record<string, unknown>;
  return probe[envKey] === REDACTED_VALUE;
}

function setStubbedSecret(doc: Document, pathSegments: string[]): void {
  const stub = new yaml.Scalar(SECRET_PLACEHOLDER_PATH);
  stub.comment = SECRET_PLACEHOLDER_COMMENT;
  doc.setIn([...pathSegments, '_file'], stub);
}

/**
 * Build the exported `drydock.yml` text from `env`'s `DD_*` keys. A key
 * already using the `__FILE` convention is carried through as a `_file` node
 * unchanged (its value is a path, not a secret, so it's already safe to
 * write). Every other sensitive key (section 4.2's redaction rules, applied
 * via `isSensitiveEnvKey`) is stubbed the same way with a placeholder path
 * and a TODO comment — its real value is never written. Everything else is
 * inlined as-is.
 */
function buildExportDocumentText(
  env: Record<string, string | undefined>,
  io: MigrateCliIo,
): string {
  const doc = new yaml.Document({});
  const ddKeys = Object.keys(env)
    .filter((key) => isDdEnvKey(key) && env[key] !== undefined)
    .sort();

  for (const key of ddKeys) {
    const value = env[key] as string;
    const isFileMarker = key.toUpperCase().endsWith(SECRET_FILE_KEY_SUFFIX);
    const baseKey = isFileMarker ? key.slice(0, -SECRET_FILE_KEY_SUFFIX.length) : key;
    const pathSegments = envKeyToPathSegments(baseKey);
    if (pathSegments.length === 0) {
      continue;
    }

    try {
      if (isFileMarker) {
        doc.setIn([...pathSegments, '_file'], value);
      } else if (isSensitiveEnvKey(key)) {
        setStubbedSecret(doc, pathSegments);
      } else {
        doc.setIn(pathSegments, value);
      }
    } catch (error) {
      // Two DD_* keys where one's YAML path is a strict prefix of the
      // other's (e.g. DD_A and DD_A_B) can't both be represented — the
      // env-name ambiguity spec-7.1-config-file.md section 2.1 documents,
      // in the one direction it's an outright collision rather than a
      // silent overwrite. Skip the offending key and say so, rather than
      // losing the whole export to one unusual env layout.
      io.err(`Skipping ${key}: ${getErrorMessage(error)}`);
    }
  }

  return String(doc);
}

async function runConfigExportCommand(
  argv: string[],
  options: RunConfigCliOptions,
): Promise<number> {
  const io = resolveCliIo(options.io);
  const parsed = parseExportOptions(argv.slice(2));
  if (parsed.kind === 'error') {
    io.err(`Error: ${parsed.error}`);
    printExportHelp(io);
    return 2;
  }
  if (parsed.options.help) {
    printExportHelp(io);
    return 0;
  }

  const env = options.env ?? process.env;
  const documentText = buildExportDocumentText(env, io);

  if (parsed.options.out === undefined) {
    io.out(documentText);
    return 0;
  }

  const resolvedPath = resolveConfiguredPath(parsed.options.out, {
    label: '--out path',
    baseDir: options.cwd ?? process.cwd(),
  });
  try {
    await writeFile(resolvedPath, documentText, { mode: 0o600 });
  } catch (error) {
    io.err(`Error: failed to write "${resolvedPath}": ${getErrorMessage(error)}`);
    return 1;
  }
  io.out(`Wrote ${resolvedPath}`);
  return 0;
}

// -----------------------------------------------------------------------
// Dispatch
// -----------------------------------------------------------------------

function printConfigCommandHelp(io: MigrateCliIo): void {
  io.out('Usage: node dist/index.js config <migrate|validate|export> [options]');
  io.out('');
  io.out('Run "node dist/index.js config <subcommand> --help" for subcommand-specific options.');
}

export async function runConfigCommandIfRequested(
  argv: string[],
  options: RunConfigCliOptions = {},
): Promise<number | null> {
  if (argv[0] !== 'config') {
    return null;
  }
  if (isConfigSubcommand(argv, 'validate')) {
    return runConfigValidateCommand(argv, options);
  }
  if (isConfigSubcommand(argv, 'export')) {
    return runConfigExportCommand(argv, options);
  }
  if (argv[1] === 'migrate') {
    return null;
  }

  const io = resolveCliIo(options.io);
  io.err(`Unknown config subcommand: "${argv[1] ?? ''}"`);
  printConfigCommandHelp(io);
  return 1;
}
