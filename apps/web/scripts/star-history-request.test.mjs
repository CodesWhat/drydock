import assert from "node:assert/strict";
import { test } from "node:test";

async function loadRequestHelpers() {
  let helpers;
  await assert.doesNotReject(async () => {
    helpers = await import("../src/lib/star-history-request.mjs");
  });
  return helpers;
}

test("star history defaults to Drydock with the light theme", async () => {
  const { resolveStarHistoryRequest } = await loadRequestHelpers();

  assert.deepEqual(resolveStarHistoryRequest(new URLSearchParams()), {
    repoSlug: "CodesWhat/drydock",
    theme: "light",
  });
});

test("star history accepts only the three CodesWhat product repositories", async () => {
  const { resolveStarHistoryRequest } = await loadRequestHelpers();

  for (const repoSlug of ["CodesWhat/drydock", "CodesWhat/sockguard", "CodesWhat/portwing"]) {
    assert.deepEqual(resolveStarHistoryRequest(new URLSearchParams({ repo: repoSlug })), {
      repoSlug,
      theme: "light",
    });
  }

  assert.equal(
    resolveStarHistoryRequest(new URLSearchParams({ repo: "CodesWhat/private-repo" })),
    undefined,
  );
  assert.equal(
    resolveStarHistoryRequest(new URLSearchParams({ repo: "attacker/example" })),
    undefined,
  );
  assert.equal(resolveStarHistoryRequest(new URLSearchParams({ repo: "sockguard" })), undefined);
});

test("star history accepts only light or dark themes", async () => {
  const { resolveStarHistoryRequest } = await loadRequestHelpers();

  assert.deepEqual(resolveStarHistoryRequest(new URLSearchParams({ theme: "dark" })), {
    repoSlug: "CodesWhat/drydock",
    theme: "dark",
  });
  assert.equal(resolveStarHistoryRequest(new URLSearchParams({ theme: "neon" })), undefined);
  assert.equal(resolveStarHistoryRequest(new URLSearchParams({ theme: "DARK" })), undefined);
});

test("star history rejects ambiguous or cache-busting query strings", async () => {
  const { resolveStarHistoryRequest } = await loadRequestHelpers();

  assert.equal(
    resolveStarHistoryRequest(new URLSearchParams({ theme: "light", url: "https://example.com" })),
    undefined,
  );
  assert.equal(
    resolveStarHistoryRequest(
      new URLSearchParams("repo=CodesWhat%2Fdrydock&repo=attacker%2Fexample"),
    ),
    undefined,
  );
  assert.equal(resolveStarHistoryRequest(new URLSearchParams("theme=light&theme=dark")), undefined);
});

test("canonical star history URLs use the first-party endpoint", async () => {
  const { buildStarHistoryUrl } = await loadRequestHelpers();

  assert.equal(
    buildStarHistoryUrl("CodesWhat/drydock", "dark"),
    "https://getdrydock.com/api/star-history?theme=dark",
  );
  assert.equal(
    buildStarHistoryUrl("CodesWhat/sockguard", "light"),
    "https://getdrydock.com/api/star-history?repo=CodesWhat%2Fsockguard&theme=light",
  );
  assert.equal(
    buildStarHistoryUrl("CodesWhat/portwing", "dark"),
    "https://getdrydock.com/api/star-history?repo=CodesWhat%2Fportwing&theme=dark",
  );
  assert.throws(() => buildStarHistoryUrl("attacker/example", "light"), /Unsupported repo/u);
});
