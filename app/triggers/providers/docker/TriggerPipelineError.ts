// @ts-nocheck

class TriggerPipelineError extends Error {
  code;

  source;

  constructor(code, message, options = {}) {
    super(message);
    this.name = 'TriggerPipelineError';
    this.code = code;
    this.source = options.source;
    if (Object.hasOwn(options, 'cause')) {
      this.cause = options.cause;
    }
  }

  static isTriggerPipelineError(error) {
    return error?.name === 'TriggerPipelineError' && typeof error?.code === 'string';
  }

  static fromUnknown(error, code, message, options = {}) {
    if (TriggerPipelineError.isTriggerPipelineError(error)) {
      return error;
    }

    const fallbackMessage = typeof message === 'string' && message.trim() !== '' ? message : code;
    const resolvedMessage =
      typeof error?.message === 'string' && error.message.trim() !== ''
        ? error.message
        : fallbackMessage;

    return new TriggerPipelineError(code, resolvedMessage, {
      ...options,
      cause: error,
    });
  }
}

export default TriggerPipelineError;
