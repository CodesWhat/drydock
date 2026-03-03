type WarnFn = (message: string) => void;

let warnFn: WarnFn = (message: string) => {
  console.warn(message);
};

export function setWarnLogger(logger: { warn: (message: string) => void }) {
  warnFn = (message: string) => logger.warn(message);
}

export function logWarn(message: string) {
  warnFn(message);
}
