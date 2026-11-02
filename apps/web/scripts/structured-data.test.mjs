import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { faqItems } from "../src/app/data/faq.ts";
import { ADVISORIES } from "../src/lib/advisories.ts";
import { BASE_URL, SITE_CONFIG } from "../src/lib/site-config.ts";
import {
  buildAdvisoryJsonLd,
  buildCompareIndexJsonLd,
  buildComparisonJsonLd,
  buildDocsJsonLd,
  buildHomeJsonLd,
  buildSecurityIndexJsonLd,
  ORGANIZATION_ID,
  SOFTWARE_ID,
  WEBSITE_ID,
} from "../src/lib/structured-data.ts";

const appDir = new URL("../src/app/", import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const compareSlugs = readdirSync(new URL("compare/", appDir), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const advisory = ADVISORIES[0];

// One graph per page type, built the way the page builds it.
const pages = {
  home: buildHomeJsonLd(),
  "compare index": buildCompareIndexJsonLd(
    compareSlugs.map((slug) => ({ name: slug, slug })),
    { name: "Compare", description: "Compare Drydock." },
  ),
  ...Object.fromEntries(
    compareSlugs.map((slug) => [
      `compare/${slug}`,
      buildComparisonJsonLd({
        slug,
        name: `${slug} vs Drydock`,
        description: `Compare ${slug} and Drydock.`,
        competitorName: slug,
      }),
    ]),
  ),
  "docs page": buildDocsJsonLd({
    url: `${BASE_URL}/docs/v1.8/configuration`,
    title: "Configuration",
    description: "Configure Drydock.",
    version: "v1.8",
    crumbs: [
      { name: "Home", url: BASE_URL },
      { name: "Documentation", url: `${BASE_URL}/docs/v1.8` },
      { name: "Configuration", url: `${BASE_URL}/docs/v1.8/configuration` },
    ],
  }),
  "security index": buildSecurityIndexJsonLd(ADVISORIES),
  "security advisory": buildAdvisoryJsonLd(advisory.slug, {
    abstract: "Not affected.",
    isBasedOn: "https://example.test/advisory",
    keywords: "a, b",
    about: [{ "@type": "Thing", name: "GHSA-x" }],
  }),
};

// Mirrors json-ld.tsx so the test parses exactly what the page ships.
const serialize = (data) => JSON.stringify(data).replace(/</g, "\\u003c");

function* walk(value) {
  if (Array.isArray(value)) for (const item of value) yield* walk(item);
  else if (value && typeof value === "object") {
    yield value;
    for (const child of Object.values(value)) yield* walk(child);
  }
}

const nodesOf = (block) => block["@graph"];
const isReference = (node) => Object.keys(node).length === 1 && "@id" in node;

for (const [name, block] of Object.entries(pages)) {
  test(`${name}: JSON-LD parses and is one schema.org @graph`, () => {
    const parsed = JSON.parse(serialize(block));
    assert.equal(parsed["@context"], "https://schema.org");
    assert.ok(Array.isArray(parsed["@graph"]) && parsed["@graph"].length > 0);
    for (const node of parsed["@graph"]) {
      assert.equal(node["@context"], undefined, "@context belongs on the block, once");
      assert.ok(node["@type"], `node without @type: ${JSON.stringify(node)}`);
    }
  });

  test(`${name}: every @id is unique and every reference resolves in the page`, () => {
    const nodes = nodesOf(block);
    const ids = nodes.filter((node) => node["@id"]).map((node) => node["@id"]);
    assert.equal(new Set(ids).size, ids.length, "duplicate @id");
    for (const object of walk(nodes)) {
      if (isReference(object)) assert.ok(ids.includes(object["@id"]), `dangling ${object["@id"]}`);
    }
  });

  test(`${name}: breadcrumbs are numbered 1..n and use absolute URLs`, () => {
    for (const node of nodesOf(block).filter((n) => n["@type"] === "BreadcrumbList")) {
      node.itemListElement.forEach((item, index) => {
        assert.equal(item.position, index + 1);
        assert.ok(item.name?.trim());
        assert.ok(item.item.startsWith(BASE_URL), item.item);
      });
      assert.equal(node.itemListElement[0].item, BASE_URL);
    }
  });

  test(`${name}: no invented ratings or reviews`, () => {
    for (const object of walk(block)) {
      for (const key of [
        "aggregateRating",
        "review",
        "ratingValue",
        "reviewCount",
        "ratingCount",
      ]) {
        assert.ok(!(key in object), `${key} is not allowed`);
      }
    }
  });
}

test("breadcrumb pages stay on routes that exist", () => {
  const routes = new Set(["", ...compareSlugs.map((s) => `compare/${s}`), "compare", "security"]);
  for (const a of ADVISORIES) routes.add(`security/${a.slug}`);
  for (const name of ["compare index", "security index", "security advisory"]) {
    for (const node of nodesOf(pages[name]).filter((n) => n["@type"] === "BreadcrumbList")) {
      for (const item of node.itemListElement) {
        const path = item.item.slice(BASE_URL.length).replace(/^\//, "");
        assert.ok(routes.has(path), `${item.item} has no route`);
      }
    }
  }
  for (const slug of compareSlugs) {
    assert.ok(existsSync(new URL(`compare/${slug}/page.tsx`, appDir)), `compare/${slug}`);
  }
  assert.ok(existsSync(new URL("security/page.tsx", appDir)));
});

test("home graph links organization, website, software, page and FAQ", () => {
  const nodes = nodesOf(pages.home);
  const byType = Object.fromEntries(nodes.map((n) => [n["@type"], n]));
  assert.equal(byType.Organization["@id"], ORGANIZATION_ID);
  assert.deepEqual(byType.WebSite.publisher, { "@id": ORGANIZATION_ID });
  assert.equal(byType.WebSite.inLanguage, "en");
  assert.ok(!("potentialAction" in byType.WebSite), "sitelinks search box is retired");
  assert.equal(byType.WebPage.isPartOf["@id"], WEBSITE_ID);
  assert.equal(byType.WebPage.about["@id"], SOFTWARE_ID);
  assert.equal(byType.SoftwareApplication.softwareVersion, SITE_CONFIG.stableVersion);
  assert.equal(byType.SoftwareApplication.description, SITE_CONFIG.description);
  assert.equal(byType.SoftwareApplication.isAccessibleForFree, true);
  assert.equal(byType.SoftwareApplication.offers.price, "0");
});

test("the organization logo is a real logo asset, not the share image", () => {
  const org = nodesOf(pages.home).find((n) => n["@type"] === "Organization");
  assert.equal(org.logo.url, `${BASE_URL}/codeswhat-logo.png`);
  assert.ok(existsSync(new URL("../public/codeswhat-logo.png", import.meta.url)));
});

test("FAQPage text equals the visible FAQ", () => {
  const faq = nodesOf(pages.home).find((n) => n["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, faqItems.length);
  faq.mainEntity.forEach((question, index) => {
    assert.equal(question.name, faqItems[index].question);
    assert.equal(question.acceptedAnswer.text, faqItems[index].answer);
  });
  const component = read("../src/components/faq.tsx");
  assert.match(component, /faqItems\.map/);
  assert.match(component, /\{item\.question\}/);
  assert.match(component, /\{item\.answer\}/);
});

test("comparison pages describe the competitor and reuse the meta description", () => {
  const nodes = nodesOf(pages["compare/watchtower"] ?? Object.values(pages)[2]);
  const page = nodes.find((n) => n["@type"] === "WebPage");
  assert.equal(page.about.length, 2);
  const competitor = nodes.find((n) => n["@id"]?.endsWith("#competitor"));
  assert.ok(competitor.name);
  assert.deepEqual(Object.keys(competitor).sort(), ["@id", "@type", "name"]);
  const route = read("../src/lib/comparison-route.tsx");
  assert.match(route, /description: config\.metadataDescription/);
});

test("the advisory carries a date that matches the sitemap and a real publisher logo", () => {
  const article = nodesOf(pages["security advisory"]).find((n) => n["@type"] === "TechArticle");
  assert.equal(article.dateModified, advisory.dateModified);
  assert.deepEqual(article.publisher, { "@id": ORGANIZATION_ID });
  assert.match(read("../src/app/sitemap.ts"), /advisory\.dateModified/);
});

test("docs crumbs come from pages that exist, not slug text", () => {
  const source = read("../src/app/docs/[[...slug]]/page.tsx");
  assert.match(source, /getDocsPage\(\[versionSlug/);
  assert.doesNotMatch(source, /charAt\(0\)\.toUpperCase/);
});

test("every JSON-LD script goes through the nonce component", () => {
  const component = read("../src/components/json-ld.tsx");
  assert.match(component, /x-nonce/);
  assert.match(component, /nonce=\{nonce\}/);
  const offenders = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) visit(path);
      else if (
        /\.tsx?$/.test(entry.name) &&
        /application\/ld\+json/.test(readFileSync(path, "utf8"))
      ) {
        offenders.push(path.pathname);
      }
    }
  };
  visit(new URL("../src/", import.meta.url));
  assert.deepEqual(
    offenders.map((p) => p.split("/src/")[1]),
    ["components/json-ld.tsx"],
  );
});
