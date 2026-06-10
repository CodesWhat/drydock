import { execFile } from 'node:child_process';

import { flatten } from '../../../model/container.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

let hasLoggedShellExecutionWarning = false;

const SHELL_UNSAFE_ENV_CHARACTERS = new Set(['`', '$', ';', '&', '|', '<', '>', '(', ')']);
const DELETE_CONTROL_CODE_POINT = 0x7f;

/**
 * Allowlisted keys inherited from the parent process environment.
 * DD_* variables are intentionally excluded to prevent credential leakage.
 * Use the `env` config option to pass specific additional keys.
 */
const COMMAND_ENV_ALLOWLIST = new Set([
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'SHELL',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
]);

interface CommandConfiguration extends TriggerConfiguration {
  cmd: string;
  shell: string;
  timeout: number;
  env: string[];
}

function sanitizeCommandEnvString(value: string) {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (
        codePoint === undefined ||
        codePoint < 0x20 ||
        codePoint === DELETE_CONTROL_CODE_POINT ||
        SHELL_UNSAFE_ENV_CHARACTERS.has(character)
      ) {
        return '_';
      }
      return character;
    })
    .join('');
}

function toCommandEnvValue(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return sanitizeCommandEnvString(value);
  }
  return sanitizeCommandEnvString(String(value));
}

function sanitizeCommandEnvVars(extraEnvVars: Record<string, unknown>) {
  const sanitizedEnvVars: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(extraEnvVars)) {
    sanitizedEnvVars[key] = toCommandEnvValue(value);
  }
  return sanitizedEnvVars;
}

export function resetShellExecutionWarningStateForTests() {
  hasLoggedShellExecutionWarning = false;
}

/**
 * Command Trigger implementation
 */
class Command extends Trigger<CommandConfiguration> {
  private logShellExecutionWarningOnce() {
    if (hasLoggedShellExecutionWarning) {
      return;
    }

    hasLoggedShellExecutionWarning = true;
    this.log.warn(
      `Security: Command trigger executes DD_ACTION_COMMAND_* cmd using ${this.configuration.shell} -c with drydock process privileges. Use only trusted command strings and interpolated values.`,
    );
  }

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      cmd: this.joi.string().required(),
      shell: this.joi.string().default('/bin/sh'),
      timeout: this.joi.number().min(0).default(60000),
      env: this.joi
        .alternatives()
        .try(
          this.joi.string().custom((value: string) =>
            value
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
          ),
          this.joi.array().items(this.joi.string()),
        )
        .default([]),
    });
  }

  /**
   * Run the command with new image version details.
   *
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    return this.runCommand({
      container_json: JSON.stringify(container),
      ...flatten(container),
    });
  }

  /**
   * Run the command with new image version details.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    return this.runCommand({
      containers_json: JSON.stringify(containers),
      ...(runtimeContext?.title ? { dd_title: runtimeContext.title } : {}),
      ...(runtimeContext?.body ? { dd_body: runtimeContext.body } : {}),
      ...(runtimeContext?.eventKind ? { dd_event_kind: runtimeContext.eventKind } : {}),
    });
  }

  /**
   * Build the child process environment from an explicit allowlist.
   *
   * Only keys in COMMAND_ENV_ALLOWLIST and any keys named in the `env` config
   * option are inherited from the parent process. DD_* secrets are excluded by
   * default to prevent credential leakage to user-authored scripts.
   */
  private buildCommandEnvironment(
    extraEnvVars: Record<string, string | undefined>,
  ): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};

    // Inherit allowlisted standard keys from parent process
    for (const key of COMMAND_ENV_ALLOWLIST) {
      if (Object.hasOwn(process.env, key) && process.env[key] !== undefined) {
        env[key] = process.env[key];
      }
    }

    // Inherit user-configured extra keys (always an array after Joi defaults it to [])
    for (const key of this.configuration.env) {
      if (Object.hasOwn(process.env, key) && process.env[key] !== undefined) {
        env[key] = process.env[key];
      }
    }

    // Drydock-provided container variables override everything
    return { ...env, ...extraEnvVars };
  }

  /**
   * Run the command.
   *
   * The subprocess receives only a restricted set of process environment
   * variables (PATH, HOME, TMPDIR, etc.) plus all drydock-provided container
   * variables. DD_* secrets (registry tokens, agent tokens, etc.) are excluded
   * by default. Use the `env` config option to pass specific additional keys
   * from the parent environment.
   *
   * @param {*} extraEnvVars
   */
  async runCommand(extraEnvVars: Record<string, unknown>) {
    this.logShellExecutionWarningOnce();

    const commandOptions = {
      env: this.buildCommandEnvironment(sanitizeCommandEnvVars(extraEnvVars)),
      timeout: this.configuration.timeout,
    };
    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          // Intentional admin-controlled shell execution from DD_ACTION_COMMAND_* env configuration.
          execFile(
            this.configuration.shell,
            ['-c', this.configuration.cmd],
            commandOptions,
            (error, stdoutOutput, stderrOutput) => {
              if (error) {
                reject(error);
                return;
              }
              resolve({
                stdout: typeof stdoutOutput === 'string' ? stdoutOutput : '',
                stderr: typeof stderrOutput === 'string' ? stderrOutput : '',
              });
            },
          );
        },
      );
      if (stdout) {
        this.log.info(`Command ${this.configuration.cmd} \nstdout ${stdout}`);
      }
      if (stderr) {
        this.log.warn(`Command ${this.configuration.cmd} \nstderr ${stderr}`);
      }
    } catch (err) {
      this.log.warn(`Command ${this.configuration.cmd} \nexecution error (${err.message})`);
    }
  }
}

export default Command;
