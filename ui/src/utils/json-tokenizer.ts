export interface JsonToken {
  text: string;
  type: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'text';
}

const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, JsonToken[]>();

export function tokenizeJson(prettyJson: string): JsonToken[] {
  const cached = tokenCache.get(prettyJson);
  if (cached) return cached;

  const tokens: JsonToken[] = [];
  let cursor = 0;
  const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

  while (cursor < prettyJson.length) {
    const character = prettyJson[cursor];

    if (/\s/u.test(character)) {
      let end = cursor + 1;
      while (end < prettyJson.length && /\s/u.test(prettyJson[end])) {
        end += 1;
      }
      tokens.push({ text: prettyJson.slice(cursor, end), type: 'text' });
      cursor = end;
      continue;
    }

    if ('{}[],:'.includes(character)) {
      tokens.push({ text: character, type: 'punctuation' });
      cursor += 1;
      continue;
    }

    if (character === '"') {
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
      while (lookAhead < prettyJson.length && /\s/u.test(prettyJson[lookAhead])) {
        lookAhead += 1;
      }

      tokens.push({
        text: prettyJson.slice(cursor, end),
        type: prettyJson[lookAhead] === ':' ? 'key' : 'string',
      });
      cursor = end;
      continue;
    }

    const remaining = prettyJson.slice(cursor);
    if (remaining.startsWith('true') || remaining.startsWith('false')) {
      const value = remaining.startsWith('true') ? 'true' : 'false';
      tokens.push({ text: value, type: 'boolean' });
      cursor += value.length;
      continue;
    }

    if (remaining.startsWith('null')) {
      tokens.push({ text: 'null', type: 'null' });
      cursor += 4;
      continue;
    }

    const numberMatch = remaining.match(numberPattern);
    if (numberMatch?.[0]) {
      tokens.push({ text: numberMatch[0], type: 'number' });
      cursor += numberMatch[0].length;
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
