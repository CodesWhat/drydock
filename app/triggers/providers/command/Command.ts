import { execFile } from 'node:child_process';

import { flatten } from '../../../model/container.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

let hasLoggedShellExecutionWarning = false;

interface CommandConfiguration extends TriggerConfiguration {
  cmd: string;
  shell: string;
  timeout: number;
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
      `Security: Command trigger executes DD_TRIGGER_COMMAND_* cmd using ${this.configuration.shell} -c with drydock process privileges. Use only trusted command strings and interpolated values.`,
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
   * Run the command.
   * @param {*} extraEnvVars
   */
  async runCommand(extraEnvVars) {
    this.logShellExecutionWarningOnce();

    const commandOptions = {
      env: {
        ...process.env,
        ...extraEnvVars,
      },
      timeout: this.configuration.timeout,
    };
    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          // Intentional admin-controlled shell execution from DD_TRIGGER_COMMAND_* env configuration.
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
