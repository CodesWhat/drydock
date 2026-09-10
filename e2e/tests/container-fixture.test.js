const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const target = {
  id: 'current-container-id',
  name: 'drydock-playwright-nginx-hooked',
  displayName: 'Nginx (Hooked)',
  watcher: 'local',
  agent: null,
};

function envelope(data) {
  return { data, total: data.length, limit: data.length, offset: 0, hasMore: false };
}

function setup(read) {
  let elapsed = 0;
  const requests = [];
  const delays = [];
  return {
    requests,
    delays,
    advance(ms) {
      elapsed += ms;
    },
    timing: {
      now: () => elapsed,
      sleep: async (ms) => {
        delays.push(ms);
        elapsed += ms;
      },
    },
    request: {
      async get(url, options) {
        requests.push({ url, ...options });
        return read(requests.length);
      },
    },
  };
}

function response(payload, status = 200) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    json: async () => payload,
  };
}

test('waits through absent lists and returns the exact rediscovered fixture without a reread', async () => {
  const { waitForCountdownFixture } = await import('../playwright/helpers/container-fixture.mjs');
  const state = setup((attempt) => response(envelope(attempt <= 3 ? [] : [target])));

  assert.equal(await waitForCountdownFixture(state.request, state.timing), target);
  assert.equal(state.requests.length, 4);
  assert.deepEqual(state.delays, [500, 500, 500]);
  assert.deepEqual(state.requests[0], { url: '/api/v1/containers', timeout: 5_000 });
});

test('ignores other names and sources, then accepts the current local identity with no agent field', async () => {
  const { waitForCountdownFixture } = await import('../playwright/helpers/container-fixture.mjs');
  const current = { ...target, id: 'another-current-id', agent: undefined };
  const wrong = [
    { ...target, name: `${target.name}-old-123` },
    { ...target, watcher: 'remote' },
    { ...target, agent: 'edge' },
    { ...target, displayName: 'Nginx (Edge)' },
  ];
  const state = setup((attempt) => response(envelope(attempt === 1 ? wrong : [current])));
  assert.equal(await waitForCountdownFixture(state.request, state.timing), current);
  assert.equal(state.requests.length, 2);
});

for (const status of [401, 429, 503]) {
  test(`fails immediately on HTTP ${status}`, async () => {
    const { waitForCountdownFixture } = await import('../playwright/helpers/container-fixture.mjs');
    const state = setup(() => response(envelope([target]), status));
    await assert.rejects(
      waitForCountdownFixture(state.request, state.timing),
      new RegExp(`fixture.*HTTP ${status}`),
    );
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.delays, []);
  });
}

for (const [label, payload, message] of [
  ['null', null, /malformed collection/],
  ['array', [], /malformed collection/],
  ['missing data', { hasMore: false }, /malformed collection/],
  ['invalid entry', envelope([null]), /malformed collection/],
  ['missing pagination', { data: [target] }, /malformed collection/],
  ['truncated', { ...envelope([target]), hasMore: true }, /truncated collection/],
  ['nonzero offset', { ...envelope([target]), offset: 1 }, /truncated collection/],
  ['inconsistent total', { ...envelope([target]), total: 2 }, /truncated collection/],
  ['ambiguous target', envelope([target, { ...target, id: 'duplicate' }]), /ambiguous/],
  ['empty id', envelope([{ ...target, id: '' }]), /invalid id/],
]) {
  test(`rejects ${label} as setup failure without polling`, async () => {
    const { waitForCountdownFixture } = await import('../playwright/helpers/container-fixture.mjs');
    const state = setup(() => response(payload));
    await assert.rejects(waitForCountdownFixture(state.request, state.timing), message);
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.delays, []);
  });
}

test('distinguishes invalid JSON and transport failure without leaking response text', async () => {
  const { waitForCountdownFixture } = await import('../playwright/helpers/container-fixture.mjs');
  const invalid = setup(() => ({
    ...response(null),
    json: async () => {
      throw new Error('private response');
    },
  }));
  await assert.rejects(
    waitForCountdownFixture(invalid.request, invalid.timing),
    /^Error: Countdown fixture.*invalid JSON$/,
  );
  const broken = setup(() => {
    throw new Error('private transport');
  });
  await assert.rejects(
    waitForCountdownFixture(broken.request, broken.timing),
    /^Error: Countdown fixture.*request failed$/,
  );
  assert.equal(broken.requests.length, 1);
});

test('bounds request and sleep by remaining Node deadline and never starts after expiry', async () => {
  const { waitForCountdownFixture } = await import('../playwright/helpers/container-fixture.mjs');
  const state = setup(() => {
    state.advance(state.requests.length === 1 ? 44_200 : 200);
    return response(envelope([]));
  });
  await assert.rejects(
    waitForCountdownFixture(state.request, state.timing),
    /Countdown fixture.*not ready after 45000ms/,
  );
  assert.deepEqual(
    state.requests.map((request) => request.timeout),
    [5_000, 300],
  );
  assert.deepEqual(state.delays, [500, 100]);
});

test('rejects a ready result arriving after the deadline', async () => {
  const { waitForCountdownFixture } = await import('../playwright/helpers/container-fixture.mjs');
  const state = setup(() => {
    state.advance(45_000);
    return response(envelope([target]));
  });
  await assert.rejects(
    waitForCountdownFixture(state.request, state.timing),
    /not ready after 45000ms/,
  );
  assert.deepEqual(state.delays, []);
});

test('immediately returns a ready fixture with the default Node clock', async () => {
  const { waitForCountdownFixture } = await import('../playwright/helpers/container-fixture.mjs');
  const state = setup(() => response(envelope([target])));
  assert.equal(await waitForCountdownFixture(state.request), target);
  assert.equal(state.requests.length, 1);
});

test('countdown awaits readiness before installing its browser clock', () => {
  const source = readFileSync(join(__dirname, '../playwright/v16-modes-pins.spec.ts'), 'utf8');
  const countdown = source.slice(source.indexOf("test('#406"), source.indexOf("test('#498"));
  const readiness = countdown.indexOf('await waitForCountdownFixture(page.context().request)');
  assert.ok(readiness >= 0);
  assert.ok(readiness < countdown.indexOf('page.clock.install'));
  assert.ok(readiness < countdown.indexOf('openContainerOverview'));
});
