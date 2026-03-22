import { clearTokenCache, tokenizeJson } from '../../src/utils/json-tokenizer';

describe('tokenizeJson', () => {
  afterEach(() => {
    clearTokenCache();
  });

  test('returns empty array for empty string', () => {
    expect(tokenizeJson('')).toEqual([]);
  });

  test('tokenizes a simple object', () => {
    const tokens = tokenizeJson('{"a": 1}');
    expect(tokens).toEqual([
      { text: '{', type: 'punctuation' },
      { text: '"a"', type: 'key' },
      { text: ':', type: 'punctuation' },
      { text: ' ', type: 'text' },
      { text: '1', type: 'number' },
      { text: '}', type: 'punctuation' },
    ]);
  });

  test('distinguishes keys from string values', () => {
    const tokens = tokenizeJson('{"name": "drydock"}');
    const keyToken = tokens.find((t) => t.type === 'key');
    const stringToken = tokens.find((t) => t.type === 'string');
    expect(keyToken?.text).toBe('"name"');
    expect(stringToken?.text).toBe('"drydock"');
  });

  test('tokenizes booleans', () => {
    const tokens = tokenizeJson('{"ok": true, "fail": false}');
    const booleans = tokens.filter((t) => t.type === 'boolean');
    expect(booleans).toEqual([
      { text: 'true', type: 'boolean' },
      { text: 'false', type: 'boolean' },
    ]);
  });

  test('tokenizes null', () => {
    const tokens = tokenizeJson('{"x": null}');
    expect(tokens).toContainEqual({ text: 'null', type: 'null' });
  });

  test('tokenizes negative numbers', () => {
    const tokens = tokenizeJson('{"n": -42}');
    expect(tokens).toContainEqual({ text: '-42', type: 'number' });
  });

  test('tokenizes floating-point numbers', () => {
    const tokens = tokenizeJson('{"pi": 3.14}');
    expect(tokens).toContainEqual({ text: '3.14', type: 'number' });
  });

  test('tokenizes scientific notation', () => {
    const tokens = tokenizeJson('{"big": 1e10}');
    expect(tokens).toContainEqual({ text: '1e10', type: 'number' });
  });

  test('tokenizes negative exponent', () => {
    const tokens = tokenizeJson('{"small": 5E-3}');
    expect(tokens).toContainEqual({ text: '5E-3', type: 'number' });
  });

  test('tokenizes arrays', () => {
    const tokens = tokenizeJson('[1, 2, 3]');
    expect(tokens[0]).toEqual({ text: '[', type: 'punctuation' });
    expect(tokens[tokens.length - 1]).toEqual({ text: ']', type: 'punctuation' });
    expect(tokens.filter((t) => t.text === ',')).toHaveLength(2);
  });

  test('preserves whitespace as text tokens', () => {
    const tokens = tokenizeJson('{\n  "a": 1\n}');
    const whitespaceTokens = tokens.filter((t) => t.type === 'text');
    expect(whitespaceTokens.length).toBeGreaterThan(0);
    for (const token of whitespaceTokens) {
      expect(token.text).toMatch(/^\s+$/);
    }
  });

  test('handles escaped quotes in strings', () => {
    const tokens = tokenizeJson('{"msg": "say \\"hello\\""}');
    const stringToken = tokens.find((t) => t.type === 'string');
    expect(stringToken?.text).toBe('"say \\"hello\\""');
  });

  test('handles consecutive escaped backslashes before closing quote', () => {
    // Value is a string ending with two literal backslashes: "path\\"
    // In JSON: {"p": "path\\\\"}  →  the \\\\ is two escaped backslashes
    const input = '{"p": "path\\\\\\\\"}';
    const tokens = tokenizeJson(input);
    const stringToken = tokens.find((t) => t.type === 'string');
    expect(stringToken?.text).toBe('"path\\\\\\\\"');
    // Verify the token stream reconstructs the input
    expect(tokens.map((t) => t.text).join('')).toBe(input);
  });

  test('classifies key with whitespace before colon', () => {
    const tokens = tokenizeJson('{"spaced"  : "val"}');
    const keyToken = tokens.find((t) => t.type === 'key');
    expect(keyToken?.text).toBe('"spaced"');
  });

  test('handles nested objects', () => {
    const input = JSON.stringify({ a: { b: 1 } }, null, 2);
    const tokens = tokenizeJson(input);
    const punctuation = tokens.filter((t) => t.type === 'punctuation');
    const braces = punctuation.filter((t) => t.text === '{' || t.text === '}');
    expect(braces).toHaveLength(4);
  });

  test('handles unknown characters as text', () => {
    // Feed a character that doesn't match any rule (a bare letter outside a string/keyword)
    const tokens = tokenizeJson('x');
    expect(tokens).toEqual([{ text: 'x', type: 'text' }]);
  });

  test('round-trips reconstructed text', () => {
    const input = JSON.stringify({ name: 'drydock', count: 42, active: true, data: null }, null, 2);
    const tokens = tokenizeJson(input);
    const reconstructed = tokens.map((t) => t.text).join('');
    expect(reconstructed).toBe(input);
  });

  test('returns cached result for identical input', () => {
    const input = '{"a": 1}';
    const first = tokenizeJson(input);
    const second = tokenizeJson(input);
    expect(second).toBe(first);
  });

  test('evicts oldest entry when cache exceeds limit', () => {
    const first = tokenizeJson('{"evict": 0}');
    for (let i = 1; i <= 500; i += 1) {
      tokenizeJson(`{"fill": ${i}}`);
    }
    const refetch = tokenizeJson('{"evict": 0}');
    expect(refetch).not.toBe(first);
    expect(refetch).toEqual(first);
  });

  test('clearTokenCache empties the cache', () => {
    const input = '{"c": true}';
    const first = tokenizeJson(input);
    clearTokenCache();
    const second = tokenizeJson(input);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });
});
