export interface AuthLogger {
  warn?: (message: string) => void;
}

export interface FailClosedAuthOptions {
  allowInsecure?: boolean;
  logger?: AuthLogger;
  insecureFlagName?: string;
}

export function failClosedAuth(message: string, options: FailClosedAuthOptions = {}): void {
  if (options.allowInsecure) {
    const insecureFlagName = options.insecureFlagName || 'insecure';
    options.logger?.warn?.(`${message}; continuing because ${insecureFlagName}=true`);
    return;
  }

  throw new Error(message);
}

export function requireAuthString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

export function withAuthorizationHeader(
  requestOptions: any,
  scheme: 'Basic' | 'Bearer',
  credentials: unknown,
  failureMessage: string,
) {
  const token = requireAuthString(credentials, failureMessage);
  return {
    ...requestOptions,
    headers: {
      ...(requestOptions?.headers || {}),
      Authorization: `${scheme} ${token}`,
    },
  };
}
