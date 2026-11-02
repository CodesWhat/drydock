import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as marketing from "../src/lib/site-content.ts";

const proofSource = readFileSync(
  new URL("../src/components/github-badges.tsx", import.meta.url),
  "utf8",
);
const siteContent = readFileSync(new URL("../src/lib/site-content.ts", import.meta.url), "utf8");
const faqSource = readFileSync(new URL("../src/app/data/faq.ts", import.meta.url), "utf8");

test("hero scopes its 100% coverage claim to TypeScript", () => {
  assert.match(proofSource, /<b>100%<\/b> (?:TS|TypeScript) coverage/);
});

test("the coverage detail lives on the stat tooltip, not in a FAQ answer", () => {
  const tooltip = proofSource.match(/<li title="([^"]*)">\s*<b>100%<\/b>/)?.[1];
  assert.ok(tooltip, "the 100% stat needs a tooltip carrying the coverage scope");
  assert.match(tooltip, /100%.*backend.*TypeScript/);
  assert.match(tooltip, /Vue.*aggregate floors/);
  assert.match(tooltip, /vue-tsc typechecks scripts and templates/);
  assert.match(tooltip, /without establishing runtime coverage/);
  assert.doesNotMatch(faqSource, /question: "[^"]*coverage/i);
});

test("hero H1 states the monitor-first stance and keeps a space between its lines", () => {
  const hero = readFileSync(new URL("../src/components/hero.tsx", import.meta.url), "utf8");
  assert.match(hero, /Know what changed <span>before anything updates<\/span>/);
  assert.doesNotMatch(hero, /Container Update\s*<span>/);
});

test("hero offers the live demo as a CTA", () => {
  const cta = readFileSync(new URL("../src/components/cta-buttons.tsx", import.meta.url), "utf8");
  assert.match(cta, /placement === "hero"/);
  assert.match(cta, /href="#demo"/);
  assert.match(cta, /Try the live demo/);
});

test("features section leads with the lifecycle and lists Update Bouncer and approvals", () => {
  const features = readFileSync(new URL("../src/components/features.tsx", import.meta.url), "utf8");
  assert.match(features, /See it, check it, then update it/);
  assert.match(features, /no paid tier/);
  const titles = marketing.features.map((feature) => feature.title);
  for (const title of ["Update Bouncer", "Approval Queue", "Image Backup", "Dry-Run Preview"]) {
    assert.ok(titles.includes(title), `${title} needs a feature card`);
  }
  assert.doesNotMatch(siteContent, /Feature-flagged for safety/);
});

test("v1.8 roadmap identifies an opt-in candidate without claiming GA", () => {
  const milestone = siteContent.match(/version: "v1\.8\.0-rc\.10",([\s\S]*?)(?=\n {2}\},)/)?.[1];
  assert.ok(milestone, "v1.8 must have a roadmap entry");
  assert.match(milestone, /title: "[^"]*RC[^"]*testing only/i);
  assert.match(milestone, /Landed:.*drydock\.yml/);
  assert.match(milestone, /Landed:.*revision-checked.*editors/);
  assert.match(milestone, /Landed:.*fleet.*bulk/i);
  assert.match(milestone, /Landed:.*SQLite/);
  assert.doesNotMatch(milestone, /status: "released"|Config file and API foundation/);
});

test("roadmap HEAD follows the active RC while retaining older candidates", () => {
  assert.equal(typeof marketing.getRoadmapHead, "function");
  assert.equal(marketing.getRoadmapHead().version, "v1.8.0-rc.10");
  assert.equal(marketing.roadmap.find((item) => item.version === "v1.7.0").status, "released");
  assert.equal(
    marketing.getRoadmapHead(marketing.roadmap.filter((item) => item.status === "released"))
      .version,
    "v1.7.0",
  );
  assert.equal(marketing.getRoadmapHead([]), undefined);
});
