const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert');
const config = require('../../config');

const baseUrl = `${config.protocol}://${config.host}:${config.port}`;
const credentials = config.username + ':' + config.password;
const authHeader = 'Basic ' + Buffer.from(credentials).toString('base64');

function resolveJsonPath(obj, path) {
    let p = path.startsWith('$') ? path.slice(1) : path;
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
        current = current[token];
    }
    return current;
}

function resolveTemplate(str, scope) {
    return str.replaceAll(/`([^`]+)`/g, (_, name) => {
        if (scope[name] !== undefined) return scope[name];
        return `\`${name}\``;
    });
}

function isRegexPattern(str) {
    return /[.*+?^${}()|[\]\\]/.test(str);
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
    if (isRegexPattern(expected)) {
        const regex = new RegExp(expected);
        assert.ok(
            regex.test(actualStr),
            `Expected "${actualStr}" to match pattern ${expected}`,
        );
    } else {
        assert.strictEqual(actualStr, expected);
    }
});

Then(/^response body should contain (.+)$/, function (text) {
    assert.ok(
        this.responseBody.includes(text),
        `Expected response body to contain "${text}"`,
    );
});

Then(/^response header (.+) should be (.+)$/, function (header, expected) {
    const actual = this.responseHeaders.get(header);
    assert.ok(actual, `Header ${header} not found`);
    if (isRegexPattern(expected)) {
        assert.ok(
            new RegExp(expected).test(actual),
            `Expected header "${header}" value "${actual}" to match "${expected}"`,
        );
    } else {
        assert.strictEqual(actual, expected);
    }
});

Then(/^response body path (.+) should be of type array with length (\d+)$/, function (path, length) {
    const actual = resolveJsonPath(this.responseJson, path);
    assert.ok(Array.isArray(actual), `Expected array at path ${path}, got ${typeof actual}`);
    assert.strictEqual(actual.length, Number(length));
});

When(/^I store the value of body path (.+) as (.+) in scenario scope$/, function (path, varName) {
    const value = resolveJsonPath(this.responseJson, path);
    assert.ok(value !== undefined, `No value found at path ${path}`);
    this.scenarioScope[varName] = value;
});
