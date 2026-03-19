export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_TOKENS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'credential',
  'credentials',
  'hash',
  'key',
  'apikey',
  'accesskey',
  'privatekey',
]);
const ENV_SENSITIVE_KEY_TOKENS = new Set(['auth', 'bearer', 'login']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getKeyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^a-zA-Z0-9]+/)
    .map((segment) => segment.toLowerCase())
    .filter(Boolean);
}

function isEnvStyleKey(key: string): boolean {
  return key.includes('_') && key === key.toUpperCase();
}

function isSensitiveKey(key: string): boolean {
  const tokens = getKeyTokens(key);
  if (tokens.some((token) => SENSITIVE_KEY_TOKENS.has(token))) {
    return true;
  }
  if (!isEnvStyleKey(key)) {
    return false;
  }
  return tokens.some((token) => ENV_SENSITIVE_KEY_TOKENS.has(token));
}

function redactMatchedValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string' && value.length === 0) {
    return value;
  }
  return REDACTED_VALUE;
}

function redactNode(node: unknown, nodeKey?: string): unknown {
  if (nodeKey && isSensitiveKey(nodeKey)) {
    return redactMatchedValue(node);
  }

  if (Array.isArray(node)) {
    return node.map((entry) => redactNode(entry));
  }

  if (!isPlainObject(node)) {
    return node;
  }

  const redactedObject: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    redactedObject[key] = redactNode(value, key);
  }
  return redactedObject;
}

export function redactDebugDump<T>(payload: T): T {
  return redactNode(payload) as T;
}
