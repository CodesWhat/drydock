/**
 * Sanitize a value for safe log interpolation.
 * Strips ANSI escapes and control characters to prevent log injection.
 */
// ANSI first: the control-character pass deletes the leading ESC byte, which
// would leave the rest of the sequence (`[31m`) behind as literal text.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape stripping for log sanitization
const ANSI_ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char stripping for log sanitization
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

export function sanitizeLogParam(value: unknown, maxLength = 200): string {
  const str = String(value ?? '');
  const cleaned = str.replace(ANSI_ESCAPES, '').replace(CONTROL_CHARS, '');
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}
