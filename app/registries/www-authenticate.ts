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
function isTokenChar(char: string | undefined): boolean {
  return typeof char === 'string' && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]$/.test(char);
}

function isOptionalWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t';
}

function skipOptionalWhitespace(value: string, index: number): number {
  let i = index;
  while (i < value.length && isOptionalWhitespace(value[i])) {
    i++;
  }
  return i;
}

function readChallengeStart(
  header: string,
  index: number,
): { scheme: string; paramsStart: number } | undefined {
  const schemeStart = skipOptionalWhitespace(header, index);
  let schemeEnd = schemeStart;
  while (schemeEnd < header.length && isTokenChar(header[schemeEnd])) {
    schemeEnd++;
  }

  if (schemeEnd === schemeStart || !isOptionalWhitespace(header[schemeEnd])) {
    return undefined;
  }

  return {
    scheme: header.slice(schemeStart, schemeEnd),
    paramsStart: skipOptionalWhitespace(header, schemeEnd),
  };
}

function findNextChallengeStart(
  header: string,
  index: number,
): { commaIndex: number; start: { scheme: string; paramsStart: number } } | undefined {
  let inQuote = false;
  let escaped = false;

  for (let i = index; i < header.length; i++) {
    const char = header[i];
    if (inQuote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inQuote = false;
      }
      continue;
    }

    if (char === '"') {
      inQuote = true;
      continue;
    }

    if (char !== ',') {
      continue;
    }

    const start = readChallengeStart(header, i + 1);
    if (start) {
      return { commaIndex: i, start };
    }
  }

  return undefined;
}

function parseAuthParams(paramsPart: string): Record<string, string> {
  const params: Record<string, string> = {};
  let i = 0;

  while (i < paramsPart.length) {
    // Skip whitespace and commas between params
    while (
      i < paramsPart.length &&
      (paramsPart[i] === ',' || isOptionalWhitespace(paramsPart[i]))
    ) {
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
    i = skipOptionalWhitespace(paramsPart, i);

    // Read value (quoted or unquoted)
    let value: string;
    if (i < paramsPart.length && paramsPart[i] === '"') {
      // Quoted value
      i++; // skip opening quote
      let quotedValue = '';
      let escaped = false;
      while (i < paramsPart.length) {
        const char = paramsPart[i];
        if (escaped) {
          quotedValue += char;
          escaped = false;
          i++;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          i++;
          continue;
        }
        if (char === '"') {
          break;
        }
        quotedValue += char;
        i++;
      }
      value = quotedValue;
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

  return params;
}

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

  const firstChallenge = readChallengeStart(trimmed, 0);
  if (!firstChallenge) {
    return undefined;
  }

  let challenge = firstChallenge;
  let paramsPart = '';
  while (true) {
    const nextChallenge = findNextChallengeStart(trimmed, challenge.paramsStart);
    const challengeEnd = nextChallenge?.commaIndex ?? trimmed.length;

    if (challenge.scheme.toLowerCase() === 'bearer') {
      paramsPart = trimmed.slice(challenge.paramsStart, challengeEnd).trim();
      break;
    }

    if (!nextChallenge) {
      return undefined;
    }
    challenge = nextChallenge.start;
  }

  const params = parseAuthParams(paramsPart);
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
