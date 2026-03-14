import fs from 'node:fs';
import { resolveConfiguredPathWithinBase } from '../runtime/paths.js';

const DEFAULT_CONFIG_CANDIDATES = [
  '.env',
  '.env.local',
  '.env.example',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const;

const LEGACY_LABEL_MAPPINGS = [
  ['wud.watch', 'dd.watch'],
  ['wud.tag.include', 'dd.tag.include'],
  ['wud.tag.exclude', 'dd.tag.exclude'],
  ['wud.tag.transform', 'dd.tag.transform'],
  ['wud.watch.digest', 'dd.watch.digest'],
  ['wud.link.template', 'dd.link.template'],
  ['wud.display.name', 'dd.display.name'],
  ['wud.display.icon', 'dd.display.icon'],
  ['wud.trigger.include', 'dd.trigger.include'],
  ['wud.trigger.exclude', 'dd.trigger.exclude'],
  ['wud.inspect.tag.path', 'dd.inspect.tag.path'],
  ['wud.registry.lookup.image', 'dd.registry.lookup.image'],
  ['wud.registry.lookup.url', 'dd.registry.lookup.url'],
  ['wud.group', 'dd.group'],
  ['wud.hook.pre', 'dd.hook.pre'],
  ['wud.hook.post', 'dd.hook.post'],
  ['wud.hook.pre.abort', 'dd.hook.pre.abort'],
  ['wud.hook.timeout', 'dd.hook.timeout'],
  ['wud.rollback.auto', 'dd.rollback.auto'],
  ['wud.rollback.window', 'dd.rollback.window'],
  ['wud.rollback.interval', 'dd.rollback.interval'],
  ['wud.compose.file', 'dd.compose.file'],
] as const;

const WATCHTOWER_LABEL_MAPPINGS = [['com.centurylinklabs.watchtower.enable', 'dd.watch']] as const;

const SUPPORTED_MIGRATION_SOURCES = ['auto', 'wud', 'watchtower'] as const;
type MigrationSource = (typeof SUPPORTED_MIGRATION_SOURCES)[number];

interface MigrateCliOptions {
  files: string[];
  dryRun: boolean;
  help: boolean;
  source: MigrationSource;
}

interface MigrateCliIo {
  out(message: string): void;
  err(message: string): void;
}

interface MigrationResult {
  content: string;
  envReplacements: number;
  labelReplacements: number;
}

interface RunMigrateCliOptions {
  cwd?: string;
  io?: MigrateCliIo;
}

type ParseOptionsResult =
  | { kind: 'ok'; options: MigrateCliOptions }
  | { kind: 'error'; error: string };

function escapeForRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPILED_WUD_LABEL_MAPPINGS = LEGACY_LABEL_MAPPINGS.map(
  ([legacyLabel, newLabel]) =>
    [new RegExp(`\\b${escapeForRegExp(legacyLabel)}\\b`, 'g'), newLabel] as const,
);

const COMPILED_WATCHTOWER_LABEL_MAPPINGS = WATCHTOWER_LABEL_MAPPINGS.map(
  ([legacyLabel, newLabel]) =>
    [new RegExp(`\\b${escapeForRegExp(legacyLabel)}\\b`, 'g'), newLabel] as const,
);
type CompiledLabelMapping = (typeof COMPILED_WUD_LABEL_MAPPINGS)[number];

function replaceWithCount(
  input: string,
  pattern: RegExp,
  buildReplacement: (...parts: string[]) => string,
) {
  let count = 0;
  const output = input.replace(pattern, (...parts: string[]) => {
    count += 1;
    return buildReplacement(...parts);
  });
  return { output, count };
}

function replaceLabelMappings(content: string, labelMappings: readonly CompiledLabelMapping[]) {
  let migratedContent = content;
  let labelReplacements = 0;

  for (const [labelPattern, newLabel] of labelMappings) {
    const replaced = replaceWithCount(migratedContent, labelPattern, () => newLabel);
    migratedContent = replaced.output;
    labelReplacements += replaced.count;
  }

  return {
    content: migratedContent,
    labelReplacements,
  };
}

function migrateWudLegacyConfigContent(content: string): MigrationResult {
  let migratedContent = content;
  let envReplacements = 0;
  let labelReplacements = 0;

  // .env style or list style env vars using "="
  for (const pattern of [
    /^(\s*export\s+)WUD_([A-Z0-9_]+)(\s*=)/gm,
    /^(\s*-\s*['"]?)WUD_([A-Z0-9_]+)(['"]?\s*=)/gm,
    /^(\s*['"]?)WUD_([A-Z0-9_]+)(['"]?\s*=)/gm,
  ]) {
    const replaced = replaceWithCount(
      migratedContent,
      pattern,
      (_full, prefix, suffix, separator) => `${prefix}DD_${suffix}${separator}`,
    );
    migratedContent = replaced.output;
    envReplacements += replaced.count;
  }

  // YAML map style env vars using ":"
  const yamlMapReplacement = replaceWithCount(
    migratedContent,
    /^(\s*['"]?)WUD_([A-Z0-9_]+)(['"]?\s*:)/gm,
    (_full, prefix, suffix, separator) => `${prefix}DD_${suffix}${separator}`,
  );
  migratedContent = yamlMapReplacement.output;
  envReplacements += yamlMapReplacement.count;
  const labelReplacementResult = replaceLabelMappings(migratedContent, COMPILED_WUD_LABEL_MAPPINGS);
  migratedContent = labelReplacementResult.content;
  labelReplacements = labelReplacementResult.labelReplacements;

  return {
    content: migratedContent,
    envReplacements,
    labelReplacements,
  };
}

function migrateWatchtowerConfigContent(content: string): MigrationResult {
  const labelReplacementResult = replaceLabelMappings(content, COMPILED_WATCHTOWER_LABEL_MAPPINGS);

  return {
    content: labelReplacementResult.content,
    envReplacements: 0,
    labelReplacements: labelReplacementResult.labelReplacements,
  };
}

function parseMigrationSource(value: string): MigrationSource | null {
  const normalized = value.toLowerCase();
  if (normalized === 'auto' || normalized === 'wud' || normalized === 'watchtower') {
    return normalized;
  }
  return null;
}

export function migrateLegacyConfigContent(
  content: string,
  source: MigrationSource = 'auto',
): MigrationResult {
  if (source === 'wud') {
    return migrateWudLegacyConfigContent(content);
  }

  if (source === 'watchtower') {
    return migrateWatchtowerConfigContent(content);
  }

  const wudResult = migrateWudLegacyConfigContent(content);
  const watchtowerResult = migrateWatchtowerConfigContent(wudResult.content);
  return {
    content: watchtowerResult.content,
    envReplacements: wudResult.envReplacements + watchtowerResult.envReplacements,
    labelReplacements: wudResult.labelReplacements + watchtowerResult.labelReplacements,
  };
}

function printHelp(io: MigrateCliIo) {
  io.out('Usage: drydock config migrate [--file <path>] [--dry-run] [--source <name>]');
  io.out('');
  io.out('Migrates legacy config inputs from supported source platforms to drydock format.');
  io.out('');
  io.out('Options:');
  io.out('  --file <path>   Migrate a specific file (can be passed multiple times)');
  io.out('  --dry-run       Show what would change without writing files');
  io.out(`  --source <name> Migration source: ${SUPPORTED_MIGRATION_SOURCES.join(', ')}`);
  io.out('  --help          Show this help');
}

type ParseOptionStepResult = { kind: 'ok'; nextIndex: number } | { kind: 'error'; error: string };

type ParseOptionValueResult =
  | { kind: 'ok'; value: string; nextIndex: number }
  | { kind: 'error'; error: string };

type OptionHandler = (
  args: string[],
  index: number,
  options: MigrateCliOptions,
) => ParseOptionStepResult;

function parseRequiredOptionValue(
  args: string[],
  index: number,
  missingValueError: string,
): ParseOptionValueResult {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    return { kind: 'error', error: missingValueError };
  }
  return { kind: 'ok', value, nextIndex: index + 1 };
}

const OPTION_HANDLERS: Record<string, OptionHandler> = {
  '--dry-run': (_args, index, options) => {
    options.dryRun = true;
    return { kind: 'ok', nextIndex: index };
  },
  '--help': (_args, index, options) => {
    options.help = true;
    return { kind: 'ok', nextIndex: index };
  },
  '-h': (_args, index, options) => {
    options.help = true;
    return { kind: 'ok', nextIndex: index };
  },
  '--file': (args, index, options) => {
    const valueResult = parseRequiredOptionValue(args, index, '--file requires a path value');
    if (valueResult.kind === 'error') {
      return valueResult;
    }
    options.files.push(valueResult.value);
    return { kind: 'ok', nextIndex: valueResult.nextIndex };
  },
  '--source': (args, index, options) => {
    const valueResult = parseRequiredOptionValue(args, index, '--source requires a value');
    if (valueResult.kind === 'error') {
      return valueResult;
    }
    const source = parseMigrationSource(valueResult.value);
    if (!source) {
      return {
        kind: 'error',
        error: `Unsupported source "${valueResult.value}". Supported: ${SUPPORTED_MIGRATION_SOURCES.join(', ')}`,
      };
    }
    options.source = source;
    return { kind: 'ok', nextIndex: valueResult.nextIndex };
  },
};

function parseOptions(args: string[]): ParseOptionsResult {
  const options: MigrateCliOptions = {
    files: [],
    dryRun: false,
    help: false,
    source: 'auto',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const handler = OPTION_HANDLERS[arg];
    if (!handler) {
      return { kind: 'error', error: `Unknown argument: ${arg}` };
    }
    const result = handler(args, i, options);
    if (result.kind === 'error') {
      return result;
    }
    i = result.nextIndex;
  }

  return { kind: 'ok', options };
}

function formatCliErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function isMissingPathError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const errorCode = (error as NodeJS.ErrnoException).code;
  return errorCode === 'ENOENT' || errorCode === 'ENOTDIR';
}

function isSymlinkPathError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const errorCode = (error as NodeJS.ErrnoException).code;
  return errorCode === 'ELOOP';
}

function writeContentToOpenFile(fileDescriptor: number, content: string) {
  const payload = Buffer.from(content, 'utf-8');
  fs.ftruncateSync(fileDescriptor, 0);

  let bytesWritten = 0;
  while (bytesWritten < payload.length) {
    const written = fs.writeSync(
      fileDescriptor,
      payload,
      bytesWritten,
      payload.length - bytesWritten,
      bytesWritten,
    );
    if (written <= 0) {
      throw new Error('write failed');
    }
    bytesWritten += written;
  }
}

function isConfigMigrateCommand(argv: string[]) {
  return argv[0] === 'config' && argv[1] === 'migrate';
}

function resolveCliIo(io?: MigrateCliIo): MigrateCliIo {
  return (
    io || {
      out: (message) => process.stdout.write(`${message}\n`),
      err: (message) => process.stderr.write(`${message}\n`),
    }
  );
}

function getConfiguredFiles(options: MigrateCliOptions) {
  return options.files.length > 0 ? options.files : [...DEFAULT_CONFIG_CANDIDATES];
}

type ResolveCandidateFilesResult =
  | { kind: 'ok'; files: string[] }
  | { kind: 'error'; error: string };

function resolveCandidateFiles(
  cwd: string,
  configuredFiles: string[],
): ResolveCandidateFilesResult {
  try {
    const files = configuredFiles.map((filePath) =>
      resolveConfiguredPathWithinBase(cwd, filePath, {
        label: '--file path',
      }),
    );
    return { kind: 'ok', files: Array.from(new Set(files)) };
  } catch (error) {
    return { kind: 'error', error: (error as Error).message };
  }
}

type MigrationStats = {
  scannedFiles: number;
  updatedFiles: number;
  missingFiles: number;
  envReplacements: number;
  labelReplacements: number;
};

function createMigrationStats(): MigrationStats {
  return {
    scannedFiles: 0,
    updatedFiles: 0,
    missingFiles: 0,
    envReplacements: 0,
    labelReplacements: 0,
  };
}

type OpenCandidateResult =
  | { kind: 'ok'; fileDescriptor: number }
  | { kind: 'missing' }
  | { kind: 'symlink' }
  | { kind: 'error'; error: string };

function openCandidateFile(
  candidate: string,
  dryRun: boolean,
  noFollowFlag: number,
): OpenCandidateResult {
  try {
    const openFlags = dryRun ? fs.constants.O_RDONLY : fs.constants.O_RDWR;
    const fileDescriptor = fs.openSync(candidate, openFlags | noFollowFlag);
    return { kind: 'ok', fileDescriptor };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { kind: 'missing' };
    }
    if (isSymlinkPathError(error)) {
      return { kind: 'symlink' };
    }
    return { kind: 'error', error: formatCliErrorMessage(error) };
  }
}

type ReadCandidateResult =
  | { kind: 'ok'; content: string }
  | { kind: 'missing' }
  | { kind: 'error'; error: string };

function readCandidateFile(fileDescriptor: number): ReadCandidateResult {
  try {
    return { kind: 'ok', content: fs.readFileSync(fileDescriptor, 'utf-8') };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { kind: 'missing' };
    }
    return { kind: 'error', error: formatCliErrorMessage(error) };
  }
}

type ProcessCandidateResult =
  | { kind: 'missing' }
  | { kind: 'skipped' }
  | {
      kind: 'processed';
      updated: boolean;
      envReplacements: number;
      labelReplacements: number;
    }
  | { kind: 'error'; error: string };

function processCandidate(
  candidate: string,
  migrateOptions: MigrateCliOptions,
  io: MigrateCliIo,
  noFollowFlag: number,
): ProcessCandidateResult {
  const openResult = openCandidateFile(candidate, migrateOptions.dryRun, noFollowFlag);
  if (openResult.kind === 'missing') {
    return { kind: 'missing' };
  }
  if (openResult.kind === 'symlink') {
    io.err(`Refusing to process symlink: ${candidate}`);
    return { kind: 'skipped' };
  }
  if (openResult.kind === 'error') {
    return { kind: 'error', error: `Failed to inspect "${candidate}": ${openResult.error}` };
  }

  const candidateFileDescriptor = openResult.fileDescriptor;
  try {
    const readResult = readCandidateFile(candidateFileDescriptor);
    if (readResult.kind === 'missing') {
      return { kind: 'missing' };
    }
    if (readResult.kind === 'error') {
      return { kind: 'error', error: `Failed to read "${candidate}": ${readResult.error}` };
    }

    const originalContent = readResult.content;
    const migrated = migrateLegacyConfigContent(originalContent, migrateOptions.source);

    if (migrated.content === originalContent) {
      io.out(`UNCHANGED ${candidate}`);
      return {
        kind: 'processed',
        updated: false,
        envReplacements: migrated.envReplacements,
        labelReplacements: migrated.labelReplacements,
      };
    }

    if (!migrateOptions.dryRun) {
      try {
        writeContentToOpenFile(candidateFileDescriptor, migrated.content);
      } catch (error) {
        return {
          kind: 'error',
          error: `Failed to write "${candidate}": ${formatCliErrorMessage(error)}`,
        };
      }
    }

    const status = migrateOptions.dryRun ? 'DRY-RUN' : 'UPDATED';
    io.out(
      `${status} ${candidate} (env=${migrated.envReplacements}, labels=${migrated.labelReplacements})`,
    );

    return {
      kind: 'processed',
      updated: true,
      envReplacements: migrated.envReplacements,
      labelReplacements: migrated.labelReplacements,
    };
  } finally {
    fs.closeSync(candidateFileDescriptor);
  }
}

type ProcessCandidatesResult = { kind: 'ok'; stats: MigrationStats } | { kind: 'error' };

function processCandidates(
  candidates: string[],
  migrateOptions: MigrateCliOptions,
  io: MigrateCliIo,
): ProcessCandidatesResult {
  const stats = createMigrationStats();
  const noFollowFlag = fs.constants.O_NOFOLLOW || 0;

  for (const candidate of candidates) {
    const result = processCandidate(candidate, migrateOptions, io, noFollowFlag);
    if (result.kind === 'error') {
      io.err(`Error: ${result.error}`);
      return { kind: 'error' };
    }
    if (result.kind === 'missing') {
      stats.missingFiles += 1;
      continue;
    }
    if (result.kind === 'skipped') {
      continue;
    }
    stats.scannedFiles += 1;
    if (result.updated) {
      stats.updatedFiles += 1;
    }
    stats.envReplacements += result.envReplacements;
    stats.labelReplacements += result.labelReplacements;
  }

  return { kind: 'ok', stats };
}

function printNoFilesScannedMessage(io: MigrateCliIo, migrateOptions: MigrateCliOptions) {
  io.out('No config files found to migrate.');
  if (migrateOptions.files.length > 0) {
    io.out(`Checked files: ${migrateOptions.files.join(', ')}`);
    return;
  }
  io.out(
    `Checked defaults: ${DEFAULT_CONFIG_CANDIDATES.join(', ')} (use --file to target specific files)`,
  );
}

function printMigrationSummary(io: MigrateCliIo, stats: MigrationStats, dryRun: boolean) {
  io.out('');
  io.out(
    `Summary: scanned=${stats.scannedFiles}, updated=${stats.updatedFiles}, missing=${stats.missingFiles}, env_rewrites=${stats.envReplacements}, label_rewrites=${stats.labelReplacements}`,
  );
  if (dryRun) {
    io.out('Dry-run mode: no files were modified.');
  }
}

export function runConfigMigrateCommandIfRequested(
  argv: string[],
  options: RunMigrateCliOptions = {},
): number | null {
  if (!isConfigMigrateCommand(argv)) {
    return null;
  }

  const io = resolveCliIo(options.io);
  const cwd = options.cwd || process.cwd();

  const parsed = parseOptions(argv.slice(2));
  if (parsed.kind === 'error') {
    io.err(`Error: ${parsed.error}`);
    printHelp(io);
    return 1;
  }
  const migrateOptions = parsed.options;
  if (migrateOptions.help) {
    printHelp(io);
    return 0;
  }

  const configuredFiles = getConfiguredFiles(migrateOptions);
  const resolvedCandidates = resolveCandidateFiles(cwd, configuredFiles);
  if (resolvedCandidates.kind === 'error') {
    io.err(`Error: ${resolvedCandidates.error}`);
    return 1;
  }

  const processResult = processCandidates(resolvedCandidates.files, migrateOptions, io);
  if (processResult.kind === 'error') {
    return 1;
  }

  if (processResult.stats.scannedFiles === 0) {
    printNoFilesScannedMessage(io, migrateOptions);
    return 0;
  }

  printMigrationSummary(io, processResult.stats, migrateOptions.dryRun);
  return 0;
}
