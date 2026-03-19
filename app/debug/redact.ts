export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_PATTERN = /(password|token|secret|key|hash)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
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
