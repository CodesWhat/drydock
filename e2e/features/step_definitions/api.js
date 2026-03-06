const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert');
const config = require('../../config');

const baseUrl = `${config.protocol}://${config.host}:${config.port}`;
const credentials = `${config.username}:${config.password}`;
const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
const FORBIDDEN_PROPERTY_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const SSE_CONNECTED_EVENT_REGEX = /event:\s*dd:connected\r?\ndata:\s*(\{[^\n]*\})/;

function hasOwn(obj, key) {
  return Object.hasOwn(obj, key);
}

function isUnsafePropertyName(name) {
  return FORBIDDEN_PROPERTY_NAMES.has(name);
}

function stripJsonPathRoot(path) {
  return path.startsWith('$') ? path.slice(1) : path;
}

function tokenizeJsonPath(path) {
  const tokens = [];
  const re = /\.([^.[]+)|\[(\d+)]/g;
  let m;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) {
      tokens.push(m[1]);
      continue;
    }
    if (m[2] !== undefined) {
      tokens.push(Number(m[2]));
    }
  }
  return tokens;
}

function resolvePathToken(current, token) {
  if (current == null) return { found: false, value: undefined };
  if (typeof token === 'number') {
    if (!Array.isArray(current)) return { found: false, value: undefined };
    return { found: true, value: current[token] };
  }
  if (isUnsafePropertyName(token)) return { found: false, value: undefined };
  if (typeof current !== 'object') return { found: false, value: undefined };
  if (!hasOwn(current, token)) return { found: false, value: undefined };
  return { found: true, value: current[token] };
}

function resolveJsonPath(obj, path) {
  const p = stripJsonPathRoot(path);
  if (p === '') return obj;
  const tokens = tokenizeJsonPath(p);

  let current = obj;
  for (const token of tokens) {
    const resolved = resolvePathToken(current, token);
    if (!resolved.found) return undefined;
    current = resolved.value;
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

function patternMemoKey(tokenIndex, valueIndex) {
  return `${tokenIndex}:${valueIndex}`;
}

function setMatchMemo(memo, key, matched) {
  memo.set(key, matched);
  return matched;
}

function matchAnyManyToken(tokens, value, tokenIndex, valueIndex, memo) {
  for (let i = valueIndex; i <= value.length; i += 1) {
    if (matchPatternFrom(tokens, value, tokenIndex + 1, i, memo)) {
      return true;
    }
  }
  return false;
}

function matchSingleToken(tokens, value, tokenIndex, valueIndex, memo) {
  const token = tokens[tokenIndex];
  if (token.type === 'any-one') {
    return matchPatternFrom(tokens, value, tokenIndex + 1, valueIndex + 1, memo);
  }
  if (token.type === 'literal' && value[valueIndex] === token.value) {
    return matchPatternFrom(tokens, value, tokenIndex + 1, valueIndex + 1, memo);
  }
  return false;
}

function matchPatternFrom(tokens, value, tokenIndex, valueIndex, memo) {
  const memoKey = patternMemoKey(tokenIndex, valueIndex);
  if (memo.has(memoKey)) {
    return memo.get(memoKey);
  }

  if (tokenIndex === tokens.length) {
    return setMatchMemo(memo, memoKey, valueIndex === value.length);
  }

  const token = tokens[tokenIndex];
  if (token.type === 'any-many') {
    return setMatchMemo(
      memo,
      memoKey,
      matchAnyManyToken(tokens, value, tokenIndex, valueIndex, memo),
    );
  }

  if (valueIndex >= value.length) {
    return setMatchMemo(memo, memoKey, false);
  }

  return setMatchMemo(memo, memoKey, matchSingleToken(tokens, value, tokenIndex, valueIndex, memo));
}

function matchesPatternTokens(tokens, value) {
  return matchPatternFrom(tokens, value, 0, 0, new Map());
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

function getDocStringContent(docString) {
  if (typeof docString === 'string') {
    return docString;
  }
  if (docString && typeof docString.content === 'string') {
    return docString.content;
  }
  return '';
}

function parseJsonDocString(docString, scope) {
  const rawBody = resolveTemplate(getDocStringContent(docString), scope);
  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new Error(
      `JSON body is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function doRequest(path, method, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = {
    Authorization: authHeader,
    ...(options.headers || {}),
  };
  const requestOptions = {
    method,
    headers,
  };
  if (options.body !== undefined) {
    requestOptions.body = options.body;
  }
  const res = await fetch(url, {
    ...requestOptions,
  });
  this.responseStatus = res.status;
  this.responseHeaders = res.headers;
  this.responseBody = await res.text();
  try {
    this.responseJson = JSON.parse(this.responseBody);
  } catch {
    this.responseJson = undefined;
  }
  this.lastRequest = { method, path };
}

async function doGet(path) {
  await doRequest.call(this, path, 'GET');
}

async function doPost(path) {
  await doRequest.call(this, path, 'POST');
}

async function requestWithJsonBody(context, method, path, docString) {
  const resolvedPath = resolveTemplate(path, context.scenarioScope);
  const body = parseJsonDocString(docString, context.scenarioScope);
  await doRequest.call(context, resolvedPath, method, {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function readSseConnectedPayload(response, timeoutMs = 5000) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('SSE response body is not readable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let body = '';

  try {
    while (Date.now() < deadline) {
      const timeRemainingMs = deadline - Date.now();
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for dd:connected event`));
        }, timeRemainingMs);
      });

      let chunk;
      try {
        chunk = await Promise.race([reader.read(), timeoutPromise]);
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (chunk.done) {
        break;
      }
      body += decoder.decode(chunk.value, { stream: true });

      const connectedMatch = body.match(SSE_CONNECTED_EVENT_REGEX);
      if (connectedMatch) {
        const payload = JSON.parse(connectedMatch[1]);
        return {
          body,
          payload,
        };
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  throw new Error('SSE dd:connected event was not received');
}

function assertResponsePathValue(context, path, expected) {
  const resolvedPath = resolveTemplate(path, context.scenarioScope);
  const actual = resolveJsonPath(context.responseJson, resolvedPath);
  const actualStr = String(actual);
  const resolvedExpected = resolveTemplate(expected, context.scenarioScope);
  if (isDynamicPattern(resolvedExpected)) {
    assert.ok(
      matchesDynamicPattern(actualStr, resolvedExpected),
      `Expected "${actualStr}" to match pattern ${resolvedExpected}`,
    );
  } else {
    assert.strictEqual(actualStr, resolvedExpected);
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

When(/^I (PUT|PATCH|DELETE) (?:to )?(.+) with json body:$/, async function (method, path, body) {
  await requestWithJsonBody(this, method, path, body);
});

When(/^I POST json to (.+):$/, async function (path, body) {
  await requestWithJsonBody(this, 'POST', path, body);
});

When(/^I open SSE connection at (.+)$/, async function (path) {
  const resolvedPath = resolveTemplate(path, this.scenarioScope);
  const url = `${baseUrl}${resolvedPath}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'text/event-stream',
    },
  });

  this.responseStatus = response.status;
  this.responseHeaders = response.headers;
  this.lastRequest = { method: 'GET', path: resolvedPath };

  if (response.status !== 200) {
    this.responseBody = await response.text();
    try {
      this.responseJson = JSON.parse(this.responseBody);
    } catch {
      this.responseJson = undefined;
    }
    return;
  }

  const connected = await readSseConnectedPayload(response);
  this.responseBody = connected.body;
  this.responseJson = undefined;
  this.scenarioScope.sseClientId = connected.payload.clientId;
  this.scenarioScope.sseClientToken = connected.payload.clientToken;
});

Then(/^response code should be (\d+)$/, function (code) {
  assert.strictEqual(this.responseStatus, Number(code));
});

Then(/^response body should be valid json$/, function () {
  assert.ok(this.responseJson !== undefined, 'Response body is not valid JSON');
});

Then(
  /^response body path (.+) should be (?!of type )(?!a sha256 digest or undefined$)(.+)$/,
  function (path, expected) {
    assertResponsePathValue(this, path, expected);
  },
);

Then(/^response body path (.+) should be a sha256 digest or undefined$/, function (path) {
  const resolvedPath = resolveTemplate(path, this.scenarioScope);
  const actual = resolveJsonPath(this.responseJson, resolvedPath);
  const actualStr = String(actual);
  const isSha256Digest = matchesDynamicPattern(actualStr, 'sha256:.*');
  assert.ok(
    actualStr === 'undefined' || isSha256Digest,
    `Expected "${actualStr}" to be a sha256 digest or undefined`,
  );
});

Then(
  /^within (\d+) seconds response body path (.+) should be (?!of type )(.+)$/,
  async function (seconds, path, expected) {
    const timeoutMs = Number(seconds) * 1000;
    const deadline = Date.now() + timeoutMs;
    let lastError;

    while (Date.now() < deadline) {
      try {
        assertResponsePathValue(this, path, expected);
        return;
      } catch (error) {
        lastError = error;
      }

      if (this.lastRequest?.method !== 'GET' || !this.lastRequest?.path) {
        break;
      }
      await doGet.call(this, this.lastRequest.path);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw (
      lastError ||
      new Error(
        `Timed out after ${seconds}s waiting for response body path ${path} to match ${expected}`,
      )
    );
  },
);

Then(/^response body should contain (.+)$/, function (text) {
  assert.ok(this.responseBody.includes(text), `Expected response body to contain "${text}"`);
});

Then(/^within (\d+) seconds response body should contain (.+)$/, async function (seconds, text) {
  const timeoutMs = Number(seconds) * 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (this.responseBody.includes(text)) {
      return;
    }

    if (this.lastRequest?.method !== 'GET' || !this.lastRequest?.path) {
      break;
    }

    await doGet.call(this, this.lastRequest.path);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out after ${seconds}s waiting for response body to contain "${text}"`);
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

Then(/^response header (.+) should contain (.+)$/, function (header, expected) {
  const actual = this.responseHeaders.get(header);
  assert.ok(actual, `Header ${header} not found`);
  assert.ok(
    actual.includes(expected),
    `Expected header "${header}" value "${actual}" to contain "${expected}"`,
  );
});

Then(
  /^response body path (.+) should be of type array with length (\d+)$/,
  function (path, length) {
    const resolvedPath = resolveTemplate(path, this.scenarioScope);
    const actual = resolveJsonPath(this.responseJson, resolvedPath);
    assert.ok(Array.isArray(actual), `Expected array at path ${path}, got ${typeof actual}`);
    assert.strictEqual(actual.length, Number(length));
  },
);

Then(
  /^response body path (.+) should be of type array with minimum length (\d+)$/,
  function (path, minLength) {
    const resolvedPath = resolveTemplate(path, this.scenarioScope);
    const actual = resolveJsonPath(this.responseJson, resolvedPath);
    assert.ok(Array.isArray(actual), `Expected array at path ${path}, got ${typeof actual}`);
    assert.ok(
      actual.length >= Number(minLength),
      `Expected array at path ${path} to have at least ${minLength} entries, got ${actual.length}`,
    );
  },
);

Then(/^scenario scope value (.+) should match (.+)$/, function (name, expected) {
  const actual = this.scenarioScope[name];
  assert.ok(actual !== undefined, `Scenario scope value "${name}" is undefined`);
  const actualStr = String(actual);
  const resolvedExpected = resolveTemplate(expected, this.scenarioScope);
  if (isDynamicPattern(resolvedExpected)) {
    assert.ok(
      matchesDynamicPattern(actualStr, resolvedExpected),
      `Expected scenario scope value "${name}"="${actualStr}" to match "${resolvedExpected}"`,
    );
  } else {
    assert.strictEqual(actualStr, resolvedExpected);
  }
});

When(/^I store the value of body path (.+) as (.+) in scenario scope$/, function (path, varName) {
  const resolvedPath = resolveTemplate(path, this.scenarioScope);
  const value = resolveJsonPath(this.responseJson, resolvedPath);
  assert.ok(value !== undefined, `No value found at path ${path}`);
  this.scenarioScope[varName] = value;
});

When(
  /^I store the index of container named (.+) as (.+) in scenario scope$/,
  function (name, varName) {
    assert.ok(Array.isArray(this.responseJson), 'Response body is not an array');
    const index = this.responseJson.findIndex((item) => String(item?.name) === name);
    assert.ok(index >= 0, `No container found with name ${name}`);
    this.scenarioScope[varName] = index;
  },
);

When(/^I store the index of registry id (.+) as (.+) in scenario scope$/, function (id, varName) {
  assert.ok(Array.isArray(this.responseJson), 'Response body is not an array');
  const index = this.responseJson.findIndex((item) => String(item?.id) === id);
  assert.ok(index >= 0, `No registry found with id ${id}`);
  this.scenarioScope[varName] = index;
});
