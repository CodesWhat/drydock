/**
 * `node dist/index.js totp <command>`: the offline two-factor commands
 * (spec 11.1.2, slice 6). This file is the command line around
 * `totp-offline.ts`: it reads the same configuration the running app does
 * (where the store is, the key ring, which Basic accounts exist), parses the
 * arguments and prints what happened.
 *
 * `status` only reads and is safe at any time. `rewrap`, `remove` and `rebind`
 * report what they would do and change nothing until `--confirm` is given, and
 * then refuse unless they have the store to themselves.
 *
 * Output is identifiers, counts and times: provider ids, usernames, subject
 * and key ids. A failure is reported by its error code, never by a message
 * that could quote what it was handling.
 */

import { getAuthenticationConfigurations, getStoreConfiguration } from '../configuration/index.js';
import { type MigrateCliIo, resolveCliIo } from '../configuration/migrate-cli.js';
import { resolveConfiguredPath, resolveConfiguredPathWithinBase } from '../runtime/paths.js';
import type { Database } from '../store/db/driver.js';
import { countUnusedRecoveryCodes, listFactors, type TotpFactorRecord } from '../store/totp.js';
import { getErrorMessage } from '../util/error.js';
import { loadTotpKeyringFromEnv } from './totp-crypto.js';
import { deriveSubjectId } from './totp-identity.js';
import {
  describeStore,
  type FactorKeyState,
  findFactors,
  type KeyringState,
  type KeyStatus,
  type LocalIdentity,
  OfflineStoreError,
  openOfflineStore,
  planRebind,
  type RebindRefusal,
  rebindFactorOffline,
  removeFactorOffline,
  rewrapFactors,
  runExclusively,
} from './totp-offline.js';

// The defaults `store/index.ts` validates its configuration with. They are
// repeated here so this command does not load the whole store to learn two
// strings; a test holds the two in step.
const DEFAULT_STORE_PATH = '/store';
const DEFAULT_STORE_DB_FILE = 'dd.sqlite';

const COMMANDS = ['status', 'rewrap', 'remove', 'rebind'] as const;
type Command = (typeof COMMANDS)[number];

const VALUE_OPTIONS = {
  '--subject': 'subject',
  '--provider': 'provider',
  '--username': 'username',
  '--to-provider': 'toProvider',
  '--db': 'db',
} as const;
type ValueOption = keyof typeof VALUE_OPTIONS;

const CONFIRM_OPTION = '--confirm';
const SELECTOR_OPTIONS = ['--subject', '--provider', '--username'] as const;

const COMMAND_OPTIONS: Record<Command, readonly string[]> = {
  status: ['--db'],
  rewrap: ['--db', CONFIRM_OPTION],
  remove: ['--db', CONFIRM_OPTION, ...SELECTOR_OPTIONS],
  rebind: ['--db', CONFIRM_OPTION, ...SELECTOR_OPTIONS, '--to-provider'],
};

interface CommandOptions {
  subject?: string;
  provider?: string;
  username?: string;
  toProvider?: string;
  db?: string;
  confirm: boolean;
}

type ParsedArguments =
  | { kind: 'help' }
  | { kind: 'error'; error: string }
  | { kind: 'command'; command: Command; options: CommandOptions };

const USAGE = [
  'Usage: node dist/index.js totp <command> [options]',
  '',
  'Offline two-factor maintenance. Commands that change the store need Drydock',
  'stopped, and only report what they would do until --confirm is given.',
  '',
  'Commands:',
  '  status    Show enrolled factors, the key each is encrypted under, and what is orphaned',
  '  rewrap    Re-encrypt every factor under the active key (key rotation)',
  "  remove    Remove one account's factor and recovery codes (lost device, codes or key)",
  '  rebind    Move the factor of a renamed account onto the account as it is now',
  '',
  'Selecting a factor (remove, rebind):',
  '  --subject <id>       Subject id, as status prints it',
  '  --provider <id>      Provider id, for example basic.eve',
  '  --username <name>    Username, exactly as configured',
  '',
  'Options:',
  '  --to-provider <id>   rebind: the configured Basic provider that takes the factor',
  '  --db <path>          Use this database file instead of the configured store',
  '  --confirm            Apply the change',
  '  --help               Show this help',
];

const NOTHING_CHANGED =
  'Nothing was changed. Stop Drydock and run the command again with --confirm to apply it.';
const AUDITED_AT_NEXT_START = 'It is written to the audit log when Drydock next starts.';

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

function isValueOption(value: string): value is ValueOption {
  return Object.hasOwn(VALUE_OPTIONS, value);
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { kind: 'help' };
  }
  const [command, ...rest] = argv;
  if (command === undefined) {
    return { kind: 'error', error: 'Name a command' };
  }
  if (!isCommand(command)) {
    return { kind: 'error', error: `Unknown command: ${command}` };
  }
  const options: CommandOptions = { confirm: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument !== CONFIRM_OPTION && !isValueOption(argument)) {
      return { kind: 'error', error: `Unknown option: ${argument}` };
    }
    if (!COMMAND_OPTIONS[command].includes(argument)) {
      return { kind: 'error', error: `${argument} does not apply to ${command}` };
    }
    if (argument === CONFIRM_OPTION) {
      options.confirm = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      return { kind: 'error', error: `${argument} needs a value` };
    }
    options[VALUE_OPTIONS[argument]] = value;
    index += 1;
  }
  if (command === 'remove' || command === 'rebind') {
    if (
      options.subject === undefined &&
      options.provider === undefined &&
      options.username === undefined
    ) {
      return {
        kind: 'error',
        error: 'Name the factor with --subject, or --provider and --username',
      };
    }
  }
  if (command === 'rebind' && options.toProvider === undefined) {
    return { kind: 'error', error: 'Name the account that takes the factor with --to-provider' };
  }
  return { kind: 'command', command, options };
}

function resolveStoreDatabasePath(override: string | undefined): string {
  if (override !== undefined) {
    return resolveConfiguredPath(override, { label: '--db path' });
  }
  const configuration = getStoreConfiguration();
  const directory = resolveConfiguredPath(
    typeof configuration.path === 'string' ? configuration.path : DEFAULT_STORE_PATH,
    { label: 'DD_STORE_PATH' },
  );
  return resolveConfiguredPathWithinBase(
    directory,
    typeof configuration.dbFile === 'string' ? configuration.dbFile : DEFAULT_STORE_DB_FILE,
    { label: 'DD_STORE_DB_FILE' },
  );
}

/** The key ring as the running app would load it. Any failure to load it is reported, not thrown. */
function readKeyringState(): KeyringState {
  try {
    const keyring = loadTotpKeyringFromEnv();
    return keyring === undefined ? { status: 'absent' } : { status: 'loaded', keyring };
  } catch (error: unknown) {
    return { status: 'unusable', code: String((error as { code?: unknown }).code) };
  }
}

/**
 * The Basic accounts in the configuration, as the subjects they sign in as.
 * A provider's id is `basic.<name>` in lower case, the way the registry builds
 * it, and its one username is taken exactly as written.
 */
function readConfiguredIdentities(): LocalIdentity[] {
  const { basic } = getAuthenticationConfigurations() as { basic?: unknown };
  if (typeof basic !== 'object' || basic === null) {
    return [];
  }
  return Object.entries(basic).flatMap(([name, configuration]) => {
    const username = (configuration as { user?: unknown } | null)?.user;
    if (typeof username !== 'string') {
      return [];
    }
    const providerId = `basic.${name.toLowerCase()}`;
    return [{ providerId, username, subjectId: deriveSubjectId(providerId, username) }];
  });
}

interface CommandContext {
  io: MigrateCliIo;
  db: Database;
  options: CommandOptions;
  keyring: KeyringState;
  identities: LocalIdentity[];
  now: () => Date;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The username is quoted as JSON, so nothing in it can pass for output of this command. */
function describeAccount(account: { providerId: string; username: string }): string {
  return `${account.providerId} / ${JSON.stringify(account.username)}`;
}

function describeFactor(factor: TotpFactorRecord): string {
  return `${describeAccount(factor)} (subject ${factor.subjectId})`;
}

const KEY_STATE_LABELS: Record<FactorKeyState, string> = {
  ok: 'readable',
  'needs-rewrap': 'readable, not the active key',
  'key-missing': 'NOT IN THE KEY RING',
  undecryptable: 'CANNOT BE DECRYPTED with the key of that id',
  unchecked: 'not checked, no usable key ring',
};

function describeKeyState(factor: TotpFactorRecord, keyState: FactorKeyState): string {
  return `key ${factor.encryptionKeyId}: ${KEY_STATE_LABELS[keyState]}`;
}

function describeKeyringProblem(keyring: Exclude<KeyringState, { status: 'loaded' }>): string {
  return keyring.status === 'absent'
    ? 'The key ring is not configured.'
    : `The key ring is configured but unusable (${keyring.code}).`;
}

function describeKeyRole(key: KeyStatus): string {
  if (key.role === 'retired') {
    return key.factors + key.enrollments > 0 ? 'retired, still in use' : 'retired, unused';
  }
  return { active: 'active', missing: 'not in the key ring', unknown: 'no usable key ring' }[
    key.role
  ];
}

/** Which keys the key ring still has to hold: the answer to "can I remove the old key yet". */
function printKeySummary(io: MigrateCliIo, keys: readonly KeyStatus[]): void {
  const stillNeeded = keys.filter(
    (key) => key.role === 'retired' && key.factors + key.enrollments > 0,
  );
  const missing = keys.filter((key) => key.role === 'missing');
  if (stillNeeded.length > 0) {
    io.out(
      `Still needed in the key ring until "rewrap" moves what they protect: ${stillNeeded.map((key) => key.keyId).join(', ')}`,
    );
  }
  if (missing.length > 0) {
    io.out(
      `Not in the key ring, so what they protect cannot be read: ${missing.map((key) => key.keyId).join(', ')}`,
    );
  }
  if (stillNeeded.length === 0 && missing.length === 0) {
    io.out('Everything is under the active key. Retired keys can be removed from the key ring.');
  }
}

function runStatus({ io, keyring, identities }: CommandContext): number {
  const status = describeStore(keyring, identities);
  io.out(
    keyring.status === 'loaded'
      ? `Key ring: active key ${JSON.stringify(keyring.keyring.activeKeyId)}; keys loaded: ${[...keyring.keyring.keys.keys()].sort().join(', ')}`
      : `Key ring: ${keyring.status === 'absent' ? 'not configured' : `configured but unusable (${keyring.code})`}`,
  );
  io.out(`Factors: ${status.factors.length}`);
  for (const { factor, keyState, orphaned, recoveryCodesRemaining } of status.factors) {
    io.out(
      `  ${describeAccount(factor)}${orphaned ? ' - ORPHANED: no configured account has this provider and username' : ''}`,
    );
    io.out(`    subject ${factor.subjectId}`);
    io.out(
      `    ${describeKeyState(factor, keyState)}; ${plural(recoveryCodesRemaining, 'recovery code')} left; activated ${factor.activatedAt}`,
    );
  }
  if (status.keys.length > 0) {
    io.out('Keys:');
    for (const key of status.keys) {
      io.out(
        `  ${key.keyId}: ${plural(key.factors, 'factor')}, ${plural(key.enrollments, 'pending enrollment')} - ${describeKeyRole(key)}`,
      );
    }
  }
  if (keyring.status === 'loaded') {
    printKeySummary(io, status.keys);
  }
  const orphaned = status.factors.filter((factor) => factor.orphaned).length;
  if (orphaned > 0) {
    io.out(
      `Orphaned factors: ${orphaned}. Until each one is moved with "rebind" or removed with "remove", local accounts without a factor of their own cannot sign in.`,
    );
  }
  if (status.pendingOfflineOperations > 0) {
    io.out(
      `Offline operations to be written to the audit log at the next start: ${status.pendingOfflineOperations}`,
    );
  }
  return 0;
}

function runRewrap({ io, db, options, keyring, identities, now }: CommandContext): number {
  if (keyring.status !== 'loaded') {
    io.err(`${describeKeyringProblem(keyring)} Nothing can be re-encrypted without it.`);
    return 1;
  }
  const active = JSON.stringify(keyring.keyring.activeKeyId);
  const sweep = () => rewrapFactors(keyring.keyring, { apply: options.confirm, now: now() });
  if (options.confirm) {
    const outcome = runExclusively(db, sweep);
    io.out(
      `Re-encrypted ${plural(outcome.rewrapped, 'factor')} under the active key ${active}; ${outcome.alreadyActive} already there.`,
    );
    io.out(
      `Discarded ${plural(outcome.enrollmentsDiscarded, 'pending enrollment')} under another key.`,
    );
    printKeySummary(io, describeStore(keyring, identities).keys);
    return reportUnreadFactors(io, outcome.failed);
  }
  const outcome = sweep();
  io.out(
    `Would re-encrypt ${plural(outcome.rewrapped, 'factor')} under the active key ${active}; ${outcome.alreadyActive} already there.`,
  );
  io.out(
    `${plural(outcome.enrollmentsDiscarded, 'pending enrollment')} under another key would be discarded.`,
  );
  io.out(NOTHING_CHANGED);
  return reportUnreadFactors(io, outcome.failed);
}

function reportUnreadFactors(
  io: MigrateCliIo,
  failed: ReturnType<typeof rewrapFactors>['failed'],
): number {
  if (failed.length === 0) {
    return 0;
  }
  io.err(`${plural(failed.length, 'factor')} could not be read and stay under their old key:`);
  for (const { factor, keyState } of failed) {
    io.err(`  ${describeFactor(factor)} - ${describeKeyState(factor, keyState)}`);
  }
  io.err(
    'Restore the key, or remove these factors with "remove", before taking the old key out of the key ring.',
  );
  return 1;
}

/** The one factor the selector names, or undefined after saying why there is not exactly one. */
function selectFactor({ io, options }: CommandContext): TotpFactorRecord | undefined {
  const matches = findFactors({
    subjectId: options.subject,
    providerId: options.provider?.toLowerCase(),
    username: options.username,
  });
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    io.err(
      'More than one factor matches. Name one with --provider and --username, or with --subject:',
    );
    for (const factor of matches) {
      io.err(`  ${describeFactor(factor)}`);
    }
    return undefined;
  }
  io.err('No factor matches.');
  const enrolled = listFactors();
  io.err(enrolled.length === 0 ? 'No factors are enrolled.' : 'Enrolled factors:');
  for (const factor of enrolled) {
    io.err(`  ${describeFactor(factor)}`);
  }
  return undefined;
}

function runRemove(context: CommandContext): number {
  const { io, db, options, now } = context;
  const factor = selectFactor(context);
  if (factor === undefined) {
    return 1;
  }
  if (!options.confirm) {
    io.out(
      `Would remove the two-factor factor of ${describeFactor(factor)}: the factor, ${plural(countUnusedRecoveryCodes(factor.factorId), 'unused recovery code')} and any pending enrollment. Every session of the account would end.`,
    );
    io.out(NOTHING_CHANGED);
    return 0;
  }
  runExclusively(db, () => removeFactorOffline(db, factor, now()));
  io.out(
    `Removed the two-factor factor of ${describeFactor(factor)}. Its recovery codes are gone and its sessions are no longer valid. The account signs in with its password alone and can enroll again.`,
  );
  io.out(AUDITED_AT_NEXT_START);
  return 0;
}

const REMOVE_INSTEAD = 'Remove it with "remove" and enroll again.';

function describeRebindRefusal(
  refusal: RebindRefusal,
  factor: TotpFactorRecord,
  target: LocalIdentity,
): string {
  switch (refusal) {
    case 'source-configured':
      return `${describeAccount(factor)} is still a configured account. Only a factor whose account is gone can be moved.`;
    case 'target-has-factor':
      return `${describeAccount(target)} already has a factor of its own. Remove that one first if this one should take its place.`;
    case 'keyring-unavailable':
      return `This factor cannot be moved: there is no usable key ring to read it with. ${REMOVE_INSTEAD}`;
    case 'key-missing':
      return `This factor cannot be moved: key ${factor.encryptionKeyId} is not in the key ring. ${REMOVE_INSTEAD}`;
    default:
      return `This factor cannot be moved: key ${factor.encryptionKeyId} in the key ring does not decrypt it. ${REMOVE_INSTEAD}`;
  }
}

function runRebind(context: CommandContext): number {
  const { io, db, options, keyring, identities, now } = context;
  const factor = selectFactor(context);
  if (factor === undefined) {
    return 1;
  }
  const targetProviderId = String(options.toProvider).toLowerCase();
  const target = identities.find((identity) => identity.providerId === targetProviderId);
  if (target === undefined) {
    if (identities.length === 0) {
      io.err('No Basic provider is configured, so there is no account to move the factor to.');
      return 1;
    }
    io.err(`${JSON.stringify(targetProviderId)} is not a configured Basic provider. Configured:`);
    for (const identity of identities) {
      io.err(`  ${describeAccount(identity)}`);
    }
    return 1;
  }
  const plan = planRebind(factor, target, identities, keyring);
  if ('refusal' in plan) {
    io.err(describeRebindRefusal(plan.refusal, factor, target));
    return 1;
  }
  if (!options.confirm) {
    io.out(
      `Would move the two-factor factor of ${describeFactor(factor)} to ${describeAccount(target)} (subject ${target.subjectId}). Every session of both would end.`,
    );
    io.out(NOTHING_CHANGED);
    return 0;
  }
  runExclusively(db, () => rebindFactorOffline(db, factor, target, plan.keyring, now()));
  io.out(
    `Moved the two-factor factor of ${describeFactor(factor)} to ${describeAccount(target)} (subject ${target.subjectId}). The same authenticator and recovery codes work for it, and sessions of both are no longer valid.`,
  );
  io.out(AUDITED_AT_NEXT_START);
  return 0;
}

const COMMAND_HANDLERS: Record<Command, (context: CommandContext) => number> = {
  status: runStatus,
  rewrap: runRewrap,
  remove: runRemove,
  rebind: runRebind,
};

function describeFailure(error: unknown, databasePath: string): string {
  if (error instanceof OfflineStoreError) {
    switch (error.code) {
      case 'NOT_FOUND':
        return `No store database exists at ${databasePath}.`;
      case 'UNREADABLE':
        return `${databasePath} is not a readable SQLite database.`;
      case 'SCHEMA_MISMATCH':
        return `${databasePath} is not a Drydock store at the schema this version uses. Start Drydock once on this version, stop it, and run the command again.`;
      default:
        return `${databasePath} is in use by another process. Stop Drydock, then run the command again.`;
    }
  }
  const { code } = error as { code?: unknown };
  return `The command failed (${typeof code === 'string' ? code : 'unexpected error'}).`;
}

export interface RunTotpCommandOptions {
  io?: MigrateCliIo;
  now?: () => Date;
  /** How long to wait for a busy store before reporting it as in use. */
  busyTimeoutMs?: number;
}

/**
 * Run one `totp` command. `argv` is everything after the word `totp`.
 * @returns the process exit code: 0 when the command did (or would do) what was asked
 */
export function runTotpCommand(
  argv: readonly string[],
  options: RunTotpCommandOptions = {},
): number {
  const io = resolveCliIo(options.io);
  const parsed = parseArguments(argv);
  if (parsed.kind === 'help') {
    for (const line of USAGE) {
      io.out(line);
    }
    return 0;
  }
  if (parsed.kind === 'error') {
    io.err(`Error: ${parsed.error}`);
    io.err('');
    for (const line of USAGE) {
      io.err(line);
    }
    return 1;
  }

  let databasePath: string;
  try {
    databasePath = resolveStoreDatabasePath(parsed.options.db);
  } catch (error: unknown) {
    io.err(`Error: ${getErrorMessage(error)}`);
    return 1;
  }

  let db: Database | undefined;
  try {
    db = openOfflineStore(databasePath, options.busyTimeoutMs);
    io.out(`Store: ${databasePath}`);
    return COMMAND_HANDLERS[parsed.command]({
      io,
      db,
      options: parsed.options,
      keyring: readKeyringState(),
      identities: readConfiguredIdentities(),
      now: options.now ?? (() => new Date()),
    });
  } catch (error: unknown) {
    io.err(describeFailure(error, databasePath));
    return 1;
  } finally {
    db?.close();
  }
}
