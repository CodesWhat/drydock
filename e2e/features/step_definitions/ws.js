const { When, Then, After } = require('@cucumber/cucumber');
const assert = require('node:assert');
const WebSocket = require('ws');
const config = require('../../config');

const baseUrl = `${config.protocol}://${config.host}:${config.port}`;
const wsBaseUrl = baseUrl.replace(/^http/, 'ws');
const credentials = `${config.username}:${config.password}`;
const authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;

function resolveTemplate(str, scope) {
  return str.replaceAll(/`([^`]+)`/g, (_, name) => {
    if (Object.hasOwn(scope, name) && scope[name] !== undefined) {
      return scope[name];
    }
    return `\`${name}\``;
  });
}

async function authenticateForWebSocket() {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { Authorization: authHeader },
    redirect: 'manual',
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookie
    .map((header) => header.split(';')[0])
    .filter(Boolean)
    .join('; ');
  assert.ok(sessionCookie, 'Login did not return a session cookie');
  this.wsSessionCookie = sessionCookie;
}

function openWebSocket(url, cookie, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: { Cookie: cookie },
    });
    const messages = [];
    let closeCode;
    let closeReason;
    let opened = false;

    const timeout = setTimeout(() => {
      if (!opened) {
        ws.terminate();
        reject(new Error(`WebSocket connection timed out after ${timeoutMs}ms`));
      } else {
        resolve({ ws, messages, closeCode, closeReason });
      }
    }, timeoutMs);

    ws.on('open', () => {
      opened = true;
    });

    ws.on('message', (data) => {
      messages.push(data.toString());
    });

    ws.on('close', (code, reason) => {
      closeCode = code;
      closeReason = reason.toString();
      clearTimeout(timeout);
      resolve({ ws, messages, closeCode, closeReason });
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

When(/^I authenticate for WebSocket$/, async function () {
  await authenticateForWebSocket.call(this);
});

When(/^I open WebSocket at (.+)$/, async function (path) {
  const resolvedPath = resolveTemplate(path, this.scenarioScope);
  assert.ok(this.wsSessionCookie, 'Must authenticate for WebSocket first');
  const url = `${wsBaseUrl}${resolvedPath}`;
  const result = await openWebSocket(url, this.wsSessionCookie);
  this.wsResult = result;
});

When(/^I open WebSocket at (.+) waiting (\d+) seconds$/, async function (path, seconds) {
  const resolvedPath = resolveTemplate(path, this.scenarioScope);
  assert.ok(this.wsSessionCookie, 'Must authenticate for WebSocket first');
  const url = `${wsBaseUrl}${resolvedPath}`;
  const result = await openWebSocket(url, this.wsSessionCookie, Number(seconds) * 1000);
  this.wsResult = result;
});

Then(/^WebSocket should have received at least (\d+) messages?$/, function (count) {
  assert.ok(this.wsResult, 'No WebSocket result available');
  assert.ok(
    this.wsResult.messages.length >= Number(count),
    `Expected at least ${count} WebSocket messages, got ${this.wsResult.messages.length}`,
  );
});

Then(/^WebSocket should have closed with code (\d+)$/, function (code) {
  assert.ok(this.wsResult, 'No WebSocket result available');
  assert.strictEqual(
    this.wsResult.closeCode,
    Number(code),
    `Expected WebSocket close code ${code}, got ${this.wsResult.closeCode} (reason: ${this.wsResult.closeReason})`,
  );
});

Then(/^every WebSocket message should be valid json$/, function () {
  assert.ok(this.wsResult, 'No WebSocket result available');
  for (const [index, raw] of this.wsResult.messages.entries()) {
    try {
      JSON.parse(raw);
    } catch {
      assert.fail(`WebSocket message ${index} is not valid JSON: ${raw.slice(0, 200)}`);
    }
  }
});

Then(/^every WebSocket message should have path (.+)$/, function (path) {
  assert.ok(this.wsResult, 'No WebSocket result available');
  for (const [index, raw] of this.wsResult.messages.entries()) {
    const parsed = JSON.parse(raw);
    const tokens = path
      .replace(/^\$\.?/, '')
      .split('.')
      .filter(Boolean);
    let current = parsed;
    for (const token of tokens) {
      assert.ok(
        current != null && Object.hasOwn(current, token),
        `WebSocket message ${index} missing path ${path}`,
      );
      current = current[token];
    }
    assert.ok(
      current !== undefined,
      `WebSocket message ${index} has undefined value at path ${path}`,
    );
  }
});

Then(/^every WebSocket message path (.+) should be one of (.+)$/, function (path, allowedValues) {
  assert.ok(this.wsResult, 'No WebSocket result available');
  const allowed = allowedValues.split(',').map((v) => v.trim());
  for (const [index, raw] of this.wsResult.messages.entries()) {
    const parsed = JSON.parse(raw);
    const tokens = path
      .replace(/^\$\.?/, '')
      .split('.')
      .filter(Boolean);
    let current = parsed;
    for (const token of tokens) {
      current = current?.[token];
    }
    assert.ok(
      allowed.includes(String(current)),
      `WebSocket message ${index} path ${path} value "${current}" not in [${allowed.join(', ')}]`,
    );
  }
});

After(function cleanupWebSocket() {
  if (this.wsResult?.ws?.readyState === WebSocket.OPEN) {
    this.wsResult.ws.close();
  }
  this.wsResult = undefined;
  this.wsSessionCookie = undefined;
});
