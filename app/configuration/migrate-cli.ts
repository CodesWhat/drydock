import fs from 'node:fs';
import path from 'node:path';

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

interface MigrateCliOptions {
  files: string[];
  dryRun: boolean;
  help: boolean;
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

function escapeForRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

export function migrateLegacyConfigContent(content: string): MigrationResult {
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

  for (const [legacyLabel, newLabel] of LEGACY_LABEL_MAPPINGS) {
    const labelPattern = new RegExp(`\\b${escapeForRegExp(legacyLabel)}\\b`, 'g');
    const replaced = replaceWithCount(migratedContent, labelPattern, () => newLabel);
    migratedContent = replaced.output;
    labelReplacements += replaced.count;
  }

  return {
    content: migratedContent,
    envReplacements,
    labelReplacements,
  };
}

function printHelp(io: MigrateCliIo) {
  io.out('Usage: drydock config migrate [--file <path>] [--dry-run]');
  io.out('');
  io.out('Migrates legacy WUD_* env vars and wud.* labels to DD_*/dd.* in config files.');
  io.out('');
  io.out('Options:');
  io.out('  --file <path>   Migrate a specific file (can be passed multiple times)');
  io.out('  --dry-run       Show what would change without writing files');
  io.out('  --help          Show this help');
}

function parseOptions(args: string[]): { options?: MigrateCliOptions; error?: string } {
  const options: MigrateCliOptions = {
    files: [],
    dryRun: false,
    help: false,
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
        return { error: '--file requires a path value' };
      }
      options.files.push(value);
      i += 1;
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }

  return { options };
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
  if (parsed.error) {
    io.err(`Error: ${parsed.error}`);
    printHelp(io);
    return 1;
  }
  const migrateOptions = parsed.options as MigrateCliOptions;
  if (migrateOptions.help) {
    printHelp(io);
    return 0;
  }

  const candidateFiles = (
    migrateOptions.files.length > 0 ? migrateOptions.files : [...DEFAULT_CONFIG_CANDIDATES]
  ).map((filePath) => path.resolve(cwd, filePath));
  const uniqueCandidates = Array.from(new Set(candidateFiles));

  let scannedFiles = 0;
  let updatedFiles = 0;
  let missingFiles = 0;
  let envReplacements = 0;
  let labelReplacements = 0;

  uniqueCandidates.forEach((candidate) => {
    if (!fs.existsSync(candidate)) {
      missingFiles += 1;
      return;
    }

    scannedFiles += 1;
    const originalContent = fs.readFileSync(candidate, 'utf-8');
    const migrated = migrateLegacyConfigContent(originalContent);
    envReplacements += migrated.envReplacements;
    labelReplacements += migrated.labelReplacements;

    if (migrated.content === originalContent) {
      io.out(`UNCHANGED ${candidate}`);
      return;
    }

    updatedFiles += 1;
    if (!migrateOptions.dryRun) {
      fs.writeFileSync(candidate, migrated.content, 'utf-8');
    }
    const status = migrateOptions.dryRun ? 'DRY-RUN' : 'UPDATED';
    io.out(
      `${status} ${candidate} (env=${migrated.envReplacements}, labels=${migrated.labelReplacements})`,
    );
  });

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
