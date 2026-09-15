import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const heroSource = readFileSync(new URL("../src/components/hero.tsx", import.meta.url), "utf8");
const siteContent = readFileSync(new URL("../src/lib/site-content.ts", import.meta.url), "utf8");
const faqSource = readFileSync(new URL("../src/app/data/faq.ts", import.meta.url), "utf8");

test("hero scopes its 100% coverage claim to TypeScript", () => {
  assert.match(heroSource, /value: "100%", label: "(?:TS|TypeScript) coverage"/);
});

test("coverage FAQ distinguishes TypeScript gates, Vue component floors, and typechecking", () => {
  const answer = faqSource.match(/question: "[^"]*coverage[^"]*",([\s\S]*?)(?=\n {2}\},)/i)?.[1];
  assert.ok(answer, "the headline coverage claim needs a detailed FAQ explanation");
  assert.match(answer, /100%.*backend.*TypeScript/);
  assert.match(answer, /Vue.*aggregate.*floors/);
  assert.match(answer, /typecheck.*scripts and templates/);
  assert.match(answer, /does not.*runtime coverage/);
});

test("v1.8 roadmap distinguishes landed development work from an available release", () => {
  const milestone = siteContent.match(/version: "v1\.8\.0",([\s\S]*?)(?=\n {2}\},)/)?.[1];
  assert.ok(milestone, "v1.8 must have a roadmap entry");
  assert.match(milestone, /title: "[^"]*development[^"]*unreleased/i);
  assert.match(milestone, /Landed:.*drydock\.yml/);
  assert.match(milestone, /Landed:.*revision-checked.*editors/);
  assert.match(milestone, /Landed:.*fleet.*bulk/i);
  assert.match(milestone, /Landed:.*SQLite/);
  assert.doesNotMatch(milestone, /status: "released"|Config file and API foundation/);
});
