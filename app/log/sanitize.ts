/**
 * Sanitize a value for safe log interpolation.
 * Strips control characters and ANSI escapes to prevent log injection.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char stripping for log sanitization
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape stripping for log sanitization
const ANSI_ESCAPES = /\x1b\[[0-9;]*m/g;

export function sanitizeLogParam(value: unknown, maxLength = 200): string {
  const str = String(value ?? '');
  const cleaned = str.replace(CONTROL_CHARS, '').replace(ANSI_ESCAPES, '');
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}
