import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const globalsSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("aurora drift is finite and does not retain a permanent compositor hint", () => {
  const motionRule = globalsSource.match(
    /\[data-aurora-motion="true"\] \.aurora-mesh \{(?<body>[\s\S]*?)\n\}/u,
  );

  assert.ok(motionRule?.groups?.body, "expected the marketing aurora motion rule");
  assert.doesNotMatch(motionRule.groups.body, /\binfinite\b/u);
  assert.doesNotMatch(motionRule.groups.body, /will-change/u);
});
