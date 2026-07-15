type WarnFn = (message: string) => void;

let warnFn: WarnFn = (message: string) => {
  console.warn(message);
};
let errorFn: WarnFn = (message: string) => {
  console.error(message);
};

export function setWarnLogger(logger: {
  warn: (message: string) => void;
  error?: (message: string) => void;
}) {
  warnFn = (message: string) => logger.warn(message);
  if (logger.error) {
    errorFn = (message: string) => logger.error?.(message);
  }
}

export function logWarn(message: string) {
  warnFn(message);
}

export function logError(message: string) {
  errorFn(message);
}
