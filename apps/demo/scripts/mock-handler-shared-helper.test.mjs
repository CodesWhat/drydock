import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const registriesHandlerPath = new URL("../src/mocks/handlers/registries.ts", import.meta.url);
const watchersHandlerPath = new URL("../src/mocks/handlers/watchers.ts", import.meta.url);
const agentsHandlerPath = new URL("../src/mocks/handlers/agents.ts", import.meta.url);
const containersDataPath = new URL("../src/mocks/data/containers.ts", import.meta.url);

function readSource(url) {
  return readFileSync(url, "utf8");
}

test("registry and watcher handlers use the shared type/name handler factory", () => {
  const registriesSource = readSource(registriesHandlerPath);
  const watchersSource = readSource(watchersHandlerPath);

  for (const source of [registriesSource, watchersSource]) {
    assert.match(source, /createTypeNameHandlers/);
    assert.doesNotMatch(source, /\.find\(\(/);
    assert.doesNotMatch(source, /new HttpResponse\(null,\s*\{\s*status:\s*404\s*\}\)/);
  }
});

test("agent log handlers use shared log entry builders", () => {
  const agentsSource = readSource(agentsHandlerPath);

  assert.match(agentsSource, /\bbuildAgentLogEntries\(/);
  assert.match(agentsSource, /\bagentLogSummarySpecs\b/);
  assert.match(agentsSource, /\bagentLogDetailSpecs\b/);
  assert.doesNotMatch(agentsSource, /\bentries:\s*\[\s*\{/);
});

test("LSCR media containers use a shared factory and common env block", () => {
  const containersSource = readSource(containersDataPath);

  assert.match(containersSource, /\blscrMediaContainer\(/);
  assert.equal(
    (containersSource.match(/key: 'TZ', value: 'America\/New_York'/g) ?? []).length,
    1,
  );
});
