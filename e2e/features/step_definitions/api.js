const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert');
const config = require('../../config');

const baseUrl = `${config.protocol}://${config.host}:${config.port}`;
const credentials = `${config.username}:${config.password}`;
const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
const FORBIDDEN_PROPERTY_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

function hasOwn(obj, key) {
  return Object.hasOwn(obj, key);
}

function isUnsafePropertyName(name) {
  return FORBIDDEN_PROPERTY_NAMES.has(name);
}

function resolveJsonPath(obj, path) {
  const p = path.startsWith('$') ? path.slice(1) : path;
  if (p === '') return obj;

  const tokens = [];
  const re = /\.([^.[]+)|\[(\d+)]/g;
  let m;
  while ((m = re.exec(p)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
  }

  let current = obj;
  for (const token of tokens) {
    if (current == null) return undefined;
    if (typeof token === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[token];
      continue;
    }
    if (isUnsafePropertyName(token)) return undefined;
    if (typeof current !== 'object') return undefined;
    if (!hasOwn(current, token)) return undefined;
    current = current[token];
  }
  return current;
}

function resolveTemplate(str, scope) {
  return str.replaceAll(/`([^`]+)`/g, (_, name) => {
    if (!isUnsafePropertyName(name) && hasOwn(scope, name) && scope[name] !== undefined) {
      return scope[name];
    }
    return `\`${name}\``;
  });
}

function isDynamicPattern(str) {
  return str.includes('.*');
}

function parsePattern(pattern) {
  const tokens = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      if (i + 1 >= pattern.length) {
        return null;
      }
      tokens.push({ type: 'literal', value: pattern[i + 1] });
      i += 1;
      continue;
    }
    if (ch === '.' && pattern[i + 1] === '*') {
      tokens.push({ type: 'any-many' });
      i += 1;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: 'any-one' });
      continue;
    }
    tokens.push({ type: 'literal', value: ch });
  }
  return tokens;
}

function matchesPatternTokens(tokens, value) {
  const memo = new Map();

  function matchFrom(tokenIndex, valueIndex) {
    const memoKey = `${tokenIndex}:${valueIndex}`;
    if (memo.has(memoKey)) {
      return memo.get(memoKey);
    }

    if (tokenIndex === tokens.length) {
      const matched = valueIndex === value.length;
      memo.set(memoKey, matched);
      return matched;
    }

    const token = tokens[tokenIndex];

    if (token.type === 'any-many') {
      for (let i = valueIndex; i <= value.length; i += 1) {
        if (matchFrom(tokenIndex + 1, i)) {
          memo.set(memoKey, true);
          return true;
        }
      }
      memo.set(memoKey, false);
      return false;
    }

    if (valueIndex >= value.length) {
      memo.set(memoKey, false);
      return false;
    }

    if (token.type === 'any-one') {
      const matched = matchFrom(tokenIndex + 1, valueIndex + 1);
      memo.set(memoKey, matched);
      return matched;
    }

    if (value[valueIndex] === token.value) {
      const matched = matchFrom(tokenIndex + 1, valueIndex + 1);
      memo.set(memoKey, matched);
      return matched;
    }

    memo.set(memoKey, false);
    return false;
  }

  return matchFrom(0, 0);
}

function matchesDynamicPattern(actual, pattern) {
  const MAX_PATTERN_LENGTH = 256;
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return false;
  }
  const tokens = parsePattern(pattern);
  if (!tokens) {
    return false;
  }
  return matchesPatternTokens(tokens, actual);
}

async function doGet(path) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader },
  });
  this.responseStatus = res.status;
  this.responseHeaders = res.headers;
  this.responseBody = await res.text();
  try {
    this.responseJson = JSON.parse(this.responseBody);
  } catch {
    this.responseJson = undefined;
  }
}

async function doPost(path) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader },
  });
  this.responseStatus = res.status;
  this.responseHeaders = res.headers;
  this.responseBody = await res.text();
  try {
    this.responseJson = JSON.parse(this.responseBody);
  } catch {
    this.responseJson = undefined;
  }
}

When(/^I GET (.+)$/, async function (path) {
  const resolved = resolveTemplate(path, this.scenarioScope);
  await doGet.call(this, resolved);
});

When(/^I POST to (.+)$/, async function (path) {
  const resolved = resolveTemplate(path, this.scenarioScope);
  await doPost.call(this, resolved);
});

Then(/^response code should be (\d+)$/, function (code) {
  assert.strictEqual(this.responseStatus, Number(code));
});

Then(/^response body should be valid json$/, function () {
  assert.ok(this.responseJson !== undefined, 'Response body is not valid JSON');
});

Then(/^response body path (.+) should be (?!of type )(.+)$/, function (path, expected) {
  const actual = resolveJsonPath(this.responseJson, path);
  const actualStr = String(actual);
  if (isDynamicPattern(expected)) {
    assert.ok(
      matchesDynamicPattern(actualStr, expected),
      `Expected "${actualStr}" to match pattern ${expected}`,
    );
  } else {
    assert.strictEqual(actualStr, expected);
  }
});

Then(/^response body should contain (.+)$/, function (text) {
  assert.ok(this.responseBody.includes(text), `Expected response body to contain "${text}"`);
});

Then(/^response header (.+) should be (.+)$/, function (header, expected) {
  const actual = this.responseHeaders.get(header);
  assert.ok(actual, `Header ${header} not found`);
  if (isDynamicPattern(expected)) {
    assert.ok(
      matchesDynamicPattern(actual, expected),
      `Expected header "${header}" value "${actual}" to match "${expected}"`,
    );
  } else {
    assert.strictEqual(actual, expected);
  }
});

Then(
  /^response body path (.+) should be of type array with length (\d+)$/,
  function (path, length) {
    const actual = resolveJsonPath(this.responseJson, path);
    assert.ok(Array.isArray(actual), `Expected array at path ${path}, got ${typeof actual}`);
    assert.strictEqual(actual.length, Number(length));
  },
);

When(/^I store the value of body path (.+) as (.+) in scenario scope$/, function (path, varName) {
  const value = resolveJsonPath(this.responseJson, path);
  assert.ok(value !== undefined, `No value found at path ${path}`);
  this.scenarioScope[varName] = value;
});
