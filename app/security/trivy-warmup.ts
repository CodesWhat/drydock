export type TrivyWarmupResult = 'ready' | 'skipped' | 'failed';

export interface TrivyWarmupConfiguration {
  enabled: boolean;
  scanner: string;
  trivy: {
    command?: string;
    server?: string;
  };
}

export interface TrivyWarmupCommand {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface TrivyDatabaseWarmupOptions {
  getConfiguration: () => TrivyWarmupConfiguration;
  run: (command: TrivyWarmupCommand) => Promise<void>;
  timeoutMs: number;
  failureCooldownMs?: number;
  execute?: (operation: () => Promise<void>) => Promise<void>;
  onFailure?: (error: unknown) => void;
}

export type TrivyDatabaseWarmup = () => Promise<TrivyWarmupResult>;

export function createTrivyDatabaseWarmup(
  options: TrivyDatabaseWarmupOptions,
): TrivyDatabaseWarmup {
  let ready = false;
  let lastFailureAt: number | undefined;
  let inFlight: Promise<TrivyWarmupResult> | undefined;

  return (): Promise<TrivyWarmupResult> => {
    if (ready) {
      return Promise.resolve('ready');
    }
    if (inFlight) {
      return inFlight;
    }
    if (
      lastFailureAt !== undefined &&
      options.failureCooldownMs !== undefined &&
      Date.now() - lastFailureAt < options.failureCooldownMs
    ) {
      return Promise.resolve('failed');
    }

    const attempt = (async (): Promise<TrivyWarmupResult> => {
      try {
        const configuration = options.getConfiguration();
        if (
          !configuration.enabled ||
          !['trivy', 'both'].includes(configuration.scanner) ||
          configuration.trivy.server
        ) {
          return 'skipped';
        }

        const command = `${configuration.trivy.command || ''}`.trim() || 'trivy';
        const operation = () =>
          options.run({
            command,
            args: [
              'image',
              '--download-db-only',
              '--timeout',
              `${Math.max(1, Math.ceil(options.timeoutMs / 1000))}s`,
            ],
            timeoutMs: options.timeoutMs,
          });
        await (options.execute ? options.execute(operation) : operation());
        ready = true;
        lastFailureAt = undefined;
        return 'ready';
      } catch (error: unknown) {
        lastFailureAt = Date.now();
        try {
          options.onFailure?.(error);
        } catch {
          // A best-effort warm-up must not fail because its observer failed.
        }
        return 'failed';
      }
    })();

    inFlight = attempt;
    void attempt.then(() => {
      if (inFlight === attempt) {
        inFlight = undefined;
      }
    });
    return attempt;
  };
}
