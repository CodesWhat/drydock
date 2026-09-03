export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_TOKENS = new Set([
  'password',
  'passwd',
  'pass',
  'secret',
  'token',
  'tokens',
  'credential',
  'credentials',
  'hash',
  'key',
  'apikey',
  'accesskey',
  'privatekey',
]);
const ENV_SENSITIVE_KEY_TOKENS = new Set(['auth', 'bearer', 'login', 'url']);

// A field name that is a credential for one provider and ordinary data for the
// rest. Pushover's `user` is its 30-character user key; SMTP's `user` is a
// mailbox address. Apprise's `urls`, Rocket.Chat's `id`, and Telegram's
// `chatid` carry credentials, while similarly named fields elsewhere do not.
// Widening the name list to catch these would hide ordinary data for no reason,
// so this is resolved by the provider segment instead.
const PROVIDER_SPECIFIC_SENSITIVE_ENV_FIELDS = new Map<string, ReadonlySet<string>>([
  ['pushover', new Set(['user'])],
  ['apprise', new Set(['urls'])],
  ['rocketchat', new Set(['id'])],
  ['telegram', new Set(['chatid'])],
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getKeyTokens(key: string): string[] {
  const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  // Stryker disable next-line ArrayDeclaration: empty fallback is equivalent because non-alphanumeric keys cannot match a sensitive token.
  const segments = normalizedKey.match(/[a-zA-Z0-9]+/g) ?? [];
  return segments.map((segment) => segment.toLowerCase());
}

function isEnvStyleKey(key: string): boolean {
  return key.includes('_') && key === key.toUpperCase();
}

// The provider segment is matched anywhere in the key, so the legacy
// `DD_TRIGGER_*` prefix resolves the same way the current `DD_NOTIFICATION_*`
// one does.
function isProviderSpecificSensitiveEnvField(tokens: string[]): boolean {
  const field = tokens.at(-1);
  if (field === undefined) {
    return false;
  }
  return tokens.some(
    (token) => PROVIDER_SPECIFIC_SENSITIVE_ENV_FIELDS.get(token)?.has(field) === true,
  );
}

function isSensitiveKey(key: string): boolean {
  const tokens = getKeyTokens(key);
  if (tokens.some((token) => SENSITIVE_KEY_TOKENS.has(token))) {
    return true;
  }
  if (!isEnvStyleKey(key)) {
    return false;
  }
  if (tokens.some((token) => ENV_SENSITIVE_KEY_TOKENS.has(token))) {
    return true;
  }
  return isProviderSpecificSensitiveEnvField(tokens);
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

function isNameValuePair(
  node: Record<string, unknown>,
): node is Record<string, unknown> & { key: string } {
  return typeof node.key === 'string' && 'value' in node;
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

  if (isNameValuePair(node)) {
    const redactedPair: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'key') {
        redactedPair[key] = value;
      } else if (key === 'value') {
        redactedPair[key] = isSensitiveKey(node.key)
          ? redactMatchedValue(value)
          : redactNode(value);
      } else {
        redactedPair[key] = redactNode(value, key);
      }
    }
    return redactedPair;
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
