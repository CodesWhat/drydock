import { execFile } from 'node:child_process';
import log from '../../log/index.js';
import { buildHookCommandEnvironment } from '../../runtime/child-process-env.js';

const MAX_OUTPUT_BYTES = 10 * 1024; // 10 KB
const DEFAULT_TIMEOUT_MS = 60_000; // 1 minute
const HOOKS_DISABLED_MESSAGE =
  'Lifecycle hooks are disabled. Set DD_HOOKS_ENABLED=true to enable execution.';

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

function isHooksExecutionEnabled(): boolean {
  return process.env.DD_HOOKS_ENABLED?.trim().toLowerCase() === 'true';
}

function isTimedOut(error: NodeJS.ErrnoException | null): boolean {
  return Boolean(error && 'killed' in error && error.killed === true);
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

function toTruncatedText(output: unknown): string {
  return typeof output === 'string' ? output.slice(0, MAX_OUTPUT_BYTES) : '';
}

function createHookResult(
  error: NodeJS.ErrnoException | null,
  stdout: unknown,
  stderr: unknown,
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

function logHookResult(hookLog: any, label: string, timeout: number, result: HookResult): void {
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
 * Uses `execFile` with `/bin/sh -c` to avoid shell injection through
 * unescaped arguments while still supporting shell syntax in the command.
 */
export async function runHook(command: string, options: HookRunnerOptions): Promise<HookResult> {
  const hookLog = log.child({ hook: options.label });
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

  hookLog.info(`Running ${options.label} hook: ${command}`);

  return new Promise<HookResult>((resolve) => {
    let child: ReturnType<typeof execFile> | undefined;
    const callback = (error: NodeJS.ErrnoException | null, stdout: unknown, stderr: unknown) => {
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
