import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const faq = readFileSync(new URL('../content/docs/current/faq/index.mdx', import.meta.url), 'utf8');
const portwingApi = readFileSync(
  new URL('../content/docs/current/api/portwing.mdx', import.meta.url),
  'utf8',
);
const agentConfiguration = readFileSync(
  new URL('../content/docs/current/configuration/agents/index.mdx', import.meta.url),
  'utf8',
);

test('Portwing FAQ links to the current controller-owned transport heading', () => {
  assert.match(
    faq,
    /\/docs\/api\/portwing#controller-owned-docker-watcher-updates-and-lifecycle-actions/u,
  );
  assert.doesNotMatch(faq, /#controller-owned-docker-watcher-and-updates/u);
  assert.match(
    portwingApi,
    /^### Controller-owned Docker watcher, updates, and lifecycle actions$/mu,
  );
});

test('Portwing FAQ does not claim partial markers or Compose have a working fallback', () => {
  assert.match(
    faq,
    /Only traditional agents that advertise remote triggers can use the legacy path/u,
  );
  assert.match(
    faq,
    /older or partial Portwing markers and Docker Compose actions have no working Portwing fallback/u,
  );
});

test('edge-agent configuration documents the controller-owned poll interval', () => {
  assert.match(
    agentConfiguration,
    /\| `DD_PORTWING_POLL_INTERVAL` \| ⚪ \| Edge-agent container refresh interval in seconds \| `300` \|/u,
  );
  assert.doesNotMatch(agentConfiguration, /`DD_AGENT_POLL_INTERVAL`/u);
});
