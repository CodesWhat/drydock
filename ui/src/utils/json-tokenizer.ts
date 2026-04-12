export interface JsonToken {
  text: string;
  type: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'text';
}

const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, JsonToken[]>();

function isWhitespace(character: string) {
  return /\s/u.test(character);
}

function readWhitespaceToken(prettyJson: string, cursor: number) {
  let end = cursor + 1;
  while (end < prettyJson.length && isWhitespace(prettyJson[end])) {
    end += 1;
  }

  return {
    token: { text: prettyJson.slice(cursor, end), type: 'text' as const },
    nextCursor: end,
  };
}

function readPunctuationToken(character: string) {
  if (!'{}[],:'.includes(character)) {
    return null;
  }

  return { text: character, type: 'punctuation' as const };
}

function readStringToken(prettyJson: string, cursor: number) {
  let end = cursor + 1;
  while (end < prettyJson.length) {
    if (prettyJson[end] === '"') {
      let backslashes = 0;
      while (end - 1 - backslashes > cursor && prettyJson[end - 1 - backslashes] === '\\') {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) {
        end += 1;
        break;
      }
    }
    end += 1;
  }

  let lookAhead = end;
  while (lookAhead < prettyJson.length && isWhitespace(prettyJson[lookAhead])) {
    lookAhead += 1;
  }

  return {
    token: {
      text: prettyJson.slice(cursor, end),
      type: prettyJson[lookAhead] === ':' ? ('key' as const) : ('string' as const),
    },
    nextCursor: end,
  };
}

function readBooleanToken(remaining: string) {
  if (remaining.startsWith('true')) {
    return { token: { text: 'true', type: 'boolean' as const }, length: 4 };
  }

  if (remaining.startsWith('false')) {
    return { token: { text: 'false', type: 'boolean' as const }, length: 5 };
  }

  return null;
}

function readNullToken(remaining: string) {
  if (!remaining.startsWith('null')) {
    return null;
  }

  return { token: { text: 'null', type: 'null' as const }, length: 4 };
}

function readNumberToken(remaining: string) {
  const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
  const numberMatch = remaining.match(numberPattern);

  if (!numberMatch?.[0]) {
    return null;
  }

  return {
    token: { text: numberMatch[0], type: 'number' as const },
    length: numberMatch[0].length,
  };
}

export function tokenizeJson(prettyJson: string): JsonToken[] {
  const cached = tokenCache.get(prettyJson);
  if (cached) return cached;

  const tokens: JsonToken[] = [];
  let cursor = 0;

  while (cursor < prettyJson.length) {
    const character = prettyJson[cursor];

    if (isWhitespace(character)) {
      const { token, nextCursor } = readWhitespaceToken(prettyJson, cursor);
      tokens.push(token);
      cursor = nextCursor;
      continue;
    }

    const punctuationToken = readPunctuationToken(character);
    if (punctuationToken) {
      tokens.push(punctuationToken);
      cursor += 1;
      continue;
    }

    if (character === '"') {
      const { token, nextCursor } = readStringToken(prettyJson, cursor);
      tokens.push(token);
      cursor = nextCursor;
      continue;
    }

    const remaining = prettyJson.slice(cursor);
    const booleanToken = readBooleanToken(remaining);
    if (booleanToken) {
      tokens.push(booleanToken.token);
      cursor += booleanToken.length;
      continue;
    }

    const nullToken = readNullToken(remaining);
    if (nullToken) {
      tokens.push(nullToken.token);
      cursor += nullToken.length;
      continue;
    }

    const numberToken = readNumberToken(remaining);
    if (numberToken) {
      tokens.push(numberToken.token);
      cursor += numberToken.length;
      continue;
    }

    tokens.push({ text: character, type: 'text' });
    cursor += 1;
  }

  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const firstKey = tokenCache.keys().next().value!;
    tokenCache.delete(firstKey);
  }
  tokenCache.set(prettyJson, tokens);

  return tokens;
}

export function clearTokenCache() {
  tokenCache.clear();
}
