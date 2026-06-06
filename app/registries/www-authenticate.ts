/**
 * Parser for the WWW-Authenticate response header.
 *
 * Implements the subset of RFC 7235 / Docker Registry token auth spec needed
 * to extract Bearer challenge parameters (realm, service, scope) so that
 * callRegistry can perform a spec-compliant token exchange on a 401 response.
 */

/**
 * Parse a `WWW-Authenticate` header value and return the Bearer challenge
 * parameters if present.
 *
 * Returns `{ realm, service?, scope? }` when the header contains a Bearer
 * challenge with at least a `realm` parameter; returns `undefined` for any
 * other input (Basic scheme, missing realm, malformed / empty / undefined
 * input).  Never throws.
 */
export function parseBearerChallenge(
  header: string | undefined,
): { realm: string; service?: string; scope?: string } | undefined {
  if (header === undefined || header === null || typeof header !== 'string') {
    return undefined;
  }

  const trimmed = header.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // Split off the scheme token: "Bearer <params>" (case-insensitive)
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return undefined;
  }

  const scheme = trimmed.slice(0, spaceIdx).trim();
  if (scheme.toLowerCase() !== 'bearer') {
    return undefined;
  }

  const paramsPart = trimmed.slice(spaceIdx + 1).trim();

  // Parse key=value or key="value" pairs.
  // We iterate character-by-character to handle quoted strings with commas.
  const params: Record<string, string> = {};
  let i = 0;

  while (i < paramsPart.length) {
    // Skip whitespace and commas between params
    while (i < paramsPart.length && (paramsPart[i] === ',' || paramsPart[i] === ' ')) {
      i++;
    }
    if (i >= paramsPart.length) break;

    // Read key
    const keyStart = i;
    while (i < paramsPart.length && paramsPart[i] !== '=') {
      i++;
    }
    const key = paramsPart.slice(keyStart, i).trim();
    if (i >= paramsPart.length || !key) {
      // No '=' found or empty key — skip
      break;
    }
    i++; // skip '='

    // Read value (quoted or unquoted)
    let value: string;
    if (i < paramsPart.length && paramsPart[i] === '"') {
      // Quoted value
      i++; // skip opening quote
      const valueStart = i;
      while (i < paramsPart.length && paramsPart[i] !== '"') {
        i++;
      }
      value = paramsPart.slice(valueStart, i);
      if (i < paramsPart.length) {
        i++; // skip closing quote
      }
    } else {
      // Unquoted value: read until comma or end
      const valueStart = i;
      while (i < paramsPart.length && paramsPart[i] !== ',') {
        i++;
      }
      value = paramsPart.slice(valueStart, i).trim();
    }

    params[key.toLowerCase()] = value;
  }

  const realm = params.realm;
  if (!realm) {
    return undefined;
  }

  const result: { realm: string; service?: string; scope?: string } = { realm };
  if (params.service !== undefined) {
    result.service = params.service;
  }
  if (params.scope !== undefined) {
    result.scope = params.scope;
  }

  return result;
}
