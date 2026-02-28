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

function parseOptions(args: string[]): ParseOptionsResult {
  const options: MigrateCliOptions = {
    files: [],
    dryRun: false,
    help: false,
    source: 'auto',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--file') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { kind: 'error', error: '--file requires a path value' };
      }
      options.files.push(value);
      i += 1;
      continue;
    }
    if (arg === '--source') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { kind: 'error', error: '--source requires a value' };
      }
      const source = parseMigrationSource(value);
      if (!source) {
        return {
          kind: 'error',
          error: `Unsupported source "${value}". Supported: ${SUPPORTED_MIGRATION_SOURCES.join(', ')}`,
        };
      }
      options.source = source;
      i += 1;
      continue;
    }
    return { kind: 'error', error: `Unknown argument: ${arg}` };
  }

  return { kind: 'ok', options };
}

function formatCliErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

export function runConfigMigrateCommandIfRequested(
  argv: string[],
  options: RunMigrateCliOptions = {},
): number | null {
  if (argv[0] !== 'config' || argv[1] !== 'migrate') {
    return null;
  }

  const io: MigrateCliIo = options.io || {
    out: (message) => process.stdout.write(`${message}\n`),
    err: (message) => process.stderr.write(`${message}\n`),
  };
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

  const configuredFiles =
    migrateOptions.files.length > 0 ? migrateOptions.files : [...DEFAULT_CONFIG_CANDIDATES];

  let candidateFiles: string[];
  try {
    candidateFiles = configuredFiles.map((filePath) =>
      resolveConfiguredPathWithinBase(cwd, filePath, {
        label: '--file path',
      }),
    );
  } catch (error) {
    io.err(`Error: ${(error as Error).message}`);
    return 1;
  }

  const uniqueCandidates = Array.from(new Set(candidateFiles));

  let scannedFiles = 0;
  let updatedFiles = 0;
  let missingFiles = 0;
  let envReplacements = 0;
  let labelReplacements = 0;

  for (const candidate of uniqueCandidates) {
    if (!fs.existsSync(candidate)) {
      missingFiles += 1;
      continue;
    }
    let candidateMetadata: fs.Stats;
    try {
      candidateMetadata = fs.lstatSync(candidate);
    } catch (error) {
      io.err(`Error: Failed to inspect "${candidate}": ${formatCliErrorMessage(error)}`);
      return 1;
    }
    if (candidateMetadata.isSymbolicLink()) {
      io.err(`Refusing to process symlink: ${candidate}`);
      continue;
    }

    scannedFiles += 1;
    let originalContent: string;
    try {
      originalContent = fs.readFileSync(candidate, 'utf-8');
    } catch (error) {
      io.err(`Error: Failed to read "${candidate}": ${formatCliErrorMessage(error)}`);
      return 1;
    }

    const migrated = migrateLegacyConfigContent(originalContent, migrateOptions.source);
    envReplacements += migrated.envReplacements;
    labelReplacements += migrated.labelReplacements;

    if (migrated.content === originalContent) {
      io.out(`UNCHANGED ${candidate}`);
      continue;
    }

    updatedFiles += 1;
    if (!migrateOptions.dryRun) {
      try {
        fs.writeFileSync(candidate, migrated.content, 'utf-8');
      } catch (error) {
        io.err(`Error: Failed to write "${candidate}": ${formatCliErrorMessage(error)}`);
        return 1;
      }
    }
    const status = migrateOptions.dryRun ? 'DRY-RUN' : 'UPDATED';
    io.out(
      `${status} ${candidate} (env=${migrated.envReplacements}, labels=${migrated.labelReplacements})`,
    );
  }

  if (scannedFiles === 0) {
    io.out('No config files found to migrate.');
    if (migrateOptions.files.length > 0) {
      io.out(`Checked files: ${migrateOptions.files.join(', ')}`);
    } else {
      io.out(
        `Checked defaults: ${DEFAULT_CONFIG_CANDIDATES.join(', ')} (use --file to target specific files)`,
      );
    }
    return 0;
  }

  io.out('');
  io.out(
    `Summary: scanned=${scannedFiles}, updated=${updatedFiles}, missing=${missingFiles}, env_rewrites=${envReplacements}, label_rewrites=${labelReplacements}`,
  );
  if (migrateOptions.dryRun) {
    io.out('Dry-run mode: no files were modified.');
  }
  return 0;
}
