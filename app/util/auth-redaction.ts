export const REDACTED_AUTH_HEADER_VALUE = '[REDACTED]';

const AUTHORIZATION_HEADER_VALUE_PATTERN =
  /\b(authorization["']?\s*[:=]\s*)(["']?)([^\r\n"',;}\]]+)/gi;
const AUTHORIZATION_SCHEME_PATTERN = /^(basic|bearer)\b/i;

function redactAuthorizationValue(value: string): string {
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? '';
  const trimmed = value.trimStart();
  const scheme = AUTHORIZATION_SCHEME_PATTERN.exec(trimmed)?.[0];

  if (scheme) {
    return `${leadingWhitespace}${scheme} ${REDACTED_AUTH_HEADER_VALUE}`;
  }
  return `${leadingWhitespace}${REDACTED_AUTH_HEADER_VALUE}`;
}

export function scrubAuthorizationHeaderValues(message: string): string {
  return message.replace(
    AUTHORIZATION_HEADER_VALUE_PATTERN,
    (_match, prefix: string, quote: string, value: string) =>
      `${prefix}${quote}${redactAuthorizationValue(value)}`,
  );
}
