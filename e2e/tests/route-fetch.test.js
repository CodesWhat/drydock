const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const http = require('node:http');
const { join } = require('node:path');
const test = require('node:test');
const { request } = require('@playwright/test');

const SPEC_DIR = join(__dirname, '../playwright');

/**
 * Answers the first request on a connection and closes the connection without
 * a response when another arrives on it. That is what a pooled client sees
 * when the server's keep-alive timeout fires as its request goes out, without
 * the six-second wait or the timing.
 */
async function startServerThatDropsReusedConnections() {
  const served = new WeakSet();
  const state = { answered: 0, dropped: 0 };
  const server = http.createServer((req, res) => {
    if (served.has(req.socket)) {
      state.dropped += 1;
      req.socket.destroy();
      return;
    }
    served.add(req.socket);
    state.answered += 1;
    res.setHeader('content-type', 'application/json');
    res.end('{"data":[]}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    baseURL: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('refetches a request whose pooled connection the server closed', async (t) => {
  const { fetchIntercepted } = await import('../playwright/helpers/route-fetch.mjs');
  const server = await startServerThatDropsReusedConnections();
  const context = await request.newContext({ baseURL: server.baseURL });
  t.after(async () => {
    await context.dispose();
    await server.close();
  });
  // route.fetch() and APIRequestContext.get() share one implementation and one
  // connection pool, so the context stands in for a route without a browser.
  const route = { fetch: (options) => context.get('/api/v1/containers', options) };

  assert.equal((await route.fetch()).status(), 200);
  await assert.rejects(route.fetch(), /socket hang up|ECONNRESET/);
  assert.deepEqual(server.state, { answered: 1, dropped: 1 });

  assert.equal((await fetchIntercepted(route)).status(), 200);
  const response = await fetchIntercepted(route);

  assert.equal(response.status(), 200);
  assert.deepEqual(await response.json(), { data: [] });
  assert.deepEqual(server.state, { answered: 3, dropped: 2 });
});

test('no spec fetches an intercepted request without the helper', () => {
  const directFetchPattern = /\broute\.fetch\s*\(/;
  const usingHelper = [];
  for (const name of readdirSync(SPEC_DIR).filter((entry) => entry.endsWith('.spec.ts'))) {
    const source = readFileSync(join(SPEC_DIR, name), 'utf8');
    assert.equal(directFetchPattern.test(source), false, `${name} calls route.fetch() directly`);
    if (source.includes('fetchIntercepted(route)')) usingHelper.push(name);
  }

  assert.match('const response = await route.fetch();', directFetchPattern);
  assert.ok(usingHelper.includes('v16-modes-pins.spec.ts'));
  assert.ok(usingHelper.includes('v16-mobile.spec.ts'));
});
