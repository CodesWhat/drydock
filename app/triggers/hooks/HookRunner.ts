import { execFile } from 'node:child_process';
import log from '../../log/index.js';
import { buildHookCommandEnvironment } from '../../runtime/child-process-env.js';

const MAX_OUTPUT_BYTES = 10 * 1024; // 10 KB
const DEFAULT_TIMEOUT_MS = 60_000; // 1 minute
const HOOKS_DISABLED_MESSAGE =
  'Lifecycle hooks are disabled. Set DD_HOOKS_ENABLED=true to enable execution.';
const INVALID_HOOK_COMMAND_MESSAGE =
  'Hook command contains unsupported shell syntax. Use a single command with arguments and optional $VAR expansions.';

interface HookRunnerOptions {
  timeout?: number;
  env?: Record<string, string>;
  label: string;
}

interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

type HookLogger = Pick<typeof log, 'info' | 'warn'>;
type HookOutput = string | Buffer;

function isHooksExecutionEnabled(): boolean {
  return process.env.DD_HOOKS_ENABLED?.trim().toLowerCase() === 'true';
}

function isTimedOut(error: NodeJS.ErrnoException | null): boolean {
  return Boolean(error && 'killed' in error && error.killed === true);
}

function isHookWhitespace(character: string): boolean {
  return character === ' ' || character === '\t';
}

function isSafeHookCharacter(character: string): boolean {
  return /[A-Za-z0-9_./:@%+=,-]/.test(character);
}

function consumeVariableReference(command: string, start: number): number | undefined {
  if (command[start] !== '$') {
    return undefined;
  }

  const nextCharacter = command[start + 1];
  if (!nextCharacter) {
    return undefined;
  }

  if (/[A-Za-z_]/.test(nextCharacter)) {
    let index = start + 2;
    while (index < command.length && /[A-Za-z0-9_]/.test(command[index])) {
      index += 1;
    }
    return index;
  }

  if (nextCharacter !== '{' || !/[A-Za-z_]/.test(command[start + 2] ?? '')) {
    return undefined;
  }

  let index = start + 3;
  while (index < command.length && /[A-Za-z0-9_]/.test(command[index])) {
    index += 1;
  }

  return command[index] === '}' ? index + 1 : undefined;
}

function consumeSingleQuotedSegment(command: string, start: number): number | undefined {
  let index = start + 1;

  while (index < command.length) {
    const character = command[index];
    if (character === "'") {
      return index + 1;
    }
    if (character === '\n' || character === '\r' || character === '\0') {
      return undefined;
    }
    index += 1;
  }

  return undefined;
}

function consumeDoubleQuotedSegment(command: string, start: number): number | undefined {
  let index = start + 1;

  while (index < command.length) {
    const character = command[index];
    if (character === '"') {
      return index + 1;
    }
    if (character === '\n' || character === '\r' || character === '\0' || character === '`') {
      return undefined;
    }
    if (character === '\\') {
      if (
        index + 1 >= command.length ||
        command[index + 1] === '\n' ||
        command[index + 1] === '\r'
      ) {
        return undefined;
      }
      index += 2;
      continue;
    }
    if (character === '$') {
      const nextIndex = consumeVariableReference(command, index);
      if (nextIndex === undefined) {
        return undefined;
      }
      index = nextIndex;
      continue;
    }
    index += 1;
  }

  return undefined;
}

function consumeHookSegment(command: string, start: number): number | undefined {
  const character = command[start];

  if (character === "'") {
    return consumeSingleQuotedSegment(command, start);
  }
  if (character === '"') {
    return consumeDoubleQuotedSegment(command, start);
  }
  if (character === '$') {
    return consumeVariableReference(command, start);
  }
  if (!isSafeHookCharacter(character)) {
    return undefined;
  }

  let index = start + 1;
  while (index < command.length && isSafeHookCharacter(command[index])) {
    index += 1;
  }
  return index;
}

function isAllowedHookCommand(command: string): boolean {
  if (/[\r\n\0]/.test(command)) {
    return false;
  }

  const trimmedCommand = command.trim();
  if (trimmedCommand.length === 0) {
    return false;
  }

  let index = 0;
  let sawToken = false;

  while (index < trimmedCommand.length) {
    while (index < trimmedCommand.length && isHookWhitespace(trimmedCommand[index])) {
      index += 1;
    }

    if (index >= trimmedCommand.length) {
      break;
    }

    sawToken = true;
    let consumedToken = false;

    while (index < trimmedCommand.length && !isHookWhitespace(trimmedCommand[index])) {
      const nextIndex = consumeHookSegment(trimmedCommand, index);
      if (nextIndex === undefined || nextIndex === index) {
        return false;
      }
      consumedToken = true;
      index = nextIndex;
    }

    if (!consumedToken) {
      return false;
    }
  }

  return sawToken;
}

function resolveExitCode(
  error: NodeJS.ErrnoException | null,
  fallbackExitCode: number | null,
  timedOut: boolean,
): number {
  if (timedOut) return 1;
  const exitCode = error?.code ?? fallbackExitCode ?? 0;
  return typeof exitCode === 'number' ? exitCode : 1;
}

function toTruncatedText(output: HookOutput): string {
  return typeof output === 'string' ? output.slice(0, MAX_OUTPUT_BYTES) : '';
}

function createHookResult(
  error: NodeJS.ErrnoException | null,
  stdout: HookOutput,
  stderr: HookOutput,
  fallbackExitCode: number | null,
): HookResult {
  const timedOut = isTimedOut(error);
  return {
    exitCode: resolveExitCode(error, fallbackExitCode, timedOut),
    stdout: toTruncatedText(stdout),
    stderr: toTruncatedText(stderr),
    timedOut,
  };
}

function logHookResult(
  hookLog: HookLogger,
  label: string,
  timeout: number,
  result: HookResult,
): void {
  if (result.timedOut) {
    hookLog.warn(`Hook ${label} timed out after ${timeout}ms`);
    return;
  }

  if (result.exitCode === 0) {
    hookLog.info(`Hook ${label} completed successfully`);
    return;
  }

  hookLog.warn(`Hook ${label} failed with exit code ${result.exitCode}: ${result.stderr}`);
}

/**
 * Run a shell command as a lifecycle hook.
 *
 * Hook commands are restricted to a single command invocation with arguments,
 * quoted strings, and simple $VAR expansions before being executed via
 * `execFile` with `/bin/sh -c`.
 */
export async function runHook(command: string, options: HookRunnerOptions): Promise<HookResult> {
  const hookLog: HookLogger = log.child({ hook: options.label });
  if (!isHooksExecutionEnabled()) {
    hookLog.info(`Skipping ${options.label} hook because DD_HOOKS_ENABLED is not true`);
    return {
      exitCode: 0,
      stdout: '',
      stderr: HOOKS_DISABLED_MESSAGE,
      timedOut: false,
    };
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  if (!isAllowedHookCommand(command)) {
    const result = {
      exitCode: 1,
      stdout: '',
      stderr: INVALID_HOOK_COMMAND_MESSAGE,
      timedOut: false,
    };
    logHookResult(hookLog, options.label, timeout, result);
    return result;
  }

  hookLog.info(`Running ${options.label} hook: ${command}`);

  return new Promise<HookResult>((resolve) => {
    let child: ReturnType<typeof execFile> | undefined;
    const callback = (
      error: NodeJS.ErrnoException | null,
      stdout: HookOutput,
      stderr: HookOutput,
    ) => {
      const result = createHookResult(error, stdout, stderr, child?.exitCode ?? null);
      logHookResult(hookLog, options.label, timeout, result);
      resolve(result);
    };

    child = execFile(
      '/bin/sh',
      ['-c', command],
      {
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: buildHookCommandEnvironment(options.env),
      },
      callback,
    );
  });
}
