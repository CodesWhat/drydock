/**
 * Process-wide switch for the one-shot `scan` command. When it is on, the
 * process is only observing: logs go to stderr so stdout carries nothing but
 * the command's output, and the Docker watcher registers without its cron,
 * startup scan or events stream. It lives in its own dependency-free module
 * because `log/index.ts` reads it while it is being evaluated, before any
 * configuration is available.
 */
let observationMode = false;

export function enableObservationMode(): void {
  observationMode = true;
}

export function isObservationMode(): boolean {
  return observationMode;
}
