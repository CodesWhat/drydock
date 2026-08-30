import { hasUrlCredentials, isSensitiveEnvEntry } from '../api/container/shared.js';

export const REDACTED_VALUE = '[REDACTED]';

// Matched anywhere in the key, once its segments are joined. Real config keys
// are compound single words — SECRETACCESSKEY, CLIENTSECRET, BOTTOKEN,
// ACCESSTOKEN, AGENTSECRET — and a segment-exact rule never saw any of them.
const SENSITIVE_KEY_SUBSTRINGS = [
  'password',
  'passwd',
  'secret',
  'token',
  'credential',
  'hash',
  'apikey',
  'accesskey',
  'privatekey',
  'clientkey',
  'signingkey',
];

// Short enough that a substring rule would fire on ordinary words (compass,
// bypass, keyfile, monkey, dispatch, path), so these still need a whole segment.
const SENSITIVE_KEY_SEGMENTS = new Set(['pass', 'key', 'pat']);

const ENV_SENSITIVE_KEY_SEGMENTS = new Set(['auth', 'bearer', 'login', 'url']);

// A field name that is a credential for one provider and ordinary data for the
// rest. Pushover's `user` is its 30-character user key; SMTP's `user` is a
// mailbox address. Widening the name list to catch the first would hide the
// second for no reason, so this is resolved by the provider segment instead.
const PROVIDER_SPECIFIC_SENSITIVE_ENV_FIELDS = new Map<string, ReadonlySet<string>>([
  ['pushover', new Set(['user'])],
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
  const joinedTokens = tokens.join('');
  if (SENSITIVE_KEY_SUBSTRINGS.some((substring) => joinedTokens.includes(substring))) {
    return true;
  }
  if (tokens.some((token) => SENSITIVE_KEY_SEGMENTS.has(token))) {
    return true;
  }
  if (!isEnvStyleKey(key)) {
    return false;
  }
  if (tokens.some((token) => ENV_SENSITIVE_KEY_SEGMENTS.has(token))) {
    return true;
  }
  return isProviderSpecificSensitiveEnvField(tokens);
}

/**
 * A value can carry a credential under a key that says nothing about it —
 * `MY_DSN=postgres://user:pass@host`. `GET /containers` already checks this;
 * the dump has to, or it is the laxer of the two views of the same data.
 */
function hasEmbeddedCredentials(value: string): boolean {
  return value.includes('@') && hasUrlCredentials(value);
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

/**
 * A `{key, value}` pair is the shape `GET /containers` classifies, and that
 * view uses its own rule set. Take both, or the dump is the laxer of the two
 * on the same entry: the shared rule reads `auth` in any key shape, this one
 * only in an env-style key, so a lowercase `basic_auth` came back in the clear.
 */
function isSensitivePairValue(key: string, value: unknown): boolean {
  return isSensitiveKey(key) || isSensitiveEnvEntry({ key, value });
}

function redactNode(node: unknown, nodeKey?: string): unknown {
  if (nodeKey && isSensitiveKey(nodeKey)) {
    return redactMatchedValue(node);
  }

  if (typeof node === 'string') {
    return hasEmbeddedCredentials(node) ? REDACTED_VALUE : node;
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
        redactedPair[key] = isSensitivePairValue(node.key, value)
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
