import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const faqDataSource = readFileSync(new URL("../src/app/data/faq.ts", import.meta.url), "utf8");

const faqComponentSource = readFileSync(
  new URL("../src/components/faq.tsx", import.meta.url),
  "utf8",
);

const homepageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

// ── Data module ──────────────────────────────────────────────────────────────

test("faq data module exports a typed faqItems array", () => {
  assert.match(faqDataSource, /export const faqItems/);
  assert.match(faqDataSource, /Array<\{/);
  assert.match(faqDataSource, /question: string/);
  assert.match(faqDataSource, /answer: string/);
});

test("faq data module contains at least 6 entries", () => {
  const questionMatches = faqDataSource.match(/question:/g);
  assert.ok(
    questionMatches !== null && questionMatches.length >= 6,
    `expected at least 6 FAQ entries, found ${questionMatches?.length ?? 0}`,
  );
});

test("every faq entry has a matching answer field", () => {
  const questionCount = (faqDataSource.match(/question:/g) ?? []).length;
  const answerCount = (faqDataSource.match(/answer:/g) ?? []).length;
  assert.equal(
    questionCount,
    answerCount,
    "every FAQ item must have exactly one question and one answer",
  );
});

test("faq data uses canonical DD_NOTIFICATION_* / DD_ACTION_* prefixes, not DD_TRIGGER_*", () => {
  // Ensure deprecated prefix isn't the recommended form in the copy
  // (the word may appear once as part of a deprecation note, but
  //  DD_NOTIFICATION_* and DD_ACTION_* must also be present)
  assert.match(faqDataSource, /DD_NOTIFICATION_/);
  assert.match(faqDataSource, /DD_ACTION_/);
});

// ── Component ────────────────────────────────────────────────────────────────

test("faq component is a client component", () => {
  assert.match(faqComponentSource, /^"use client"/m);
});

test("faq component imports faqItems from the data module", () => {
  assert.match(faqComponentSource, /from "@\/app\/data\/faq"/);
  assert.match(faqComponentSource, /\bfaqItems\b/);
});

test("faq component imports SectionHeading", () => {
  assert.match(faqComponentSource, /from "@\/components\/section-heading"/);
  assert.match(faqComponentSource, /\bSectionHeading\b/);
});

test("faq component exports a named FAQ function", () => {
  assert.match(faqComponentSource, /export function FAQ\b/);
});

test("faq component uses accessible button elements with aria attributes", () => {
  assert.match(faqComponentSource, /<button/);
  assert.match(faqComponentSource, /aria-expanded/);
  assert.match(faqComponentSource, /aria-controls/);
  // Answer panels are linked by id (aria-controls points to answerId)
  assert.match(faqComponentSource, /answerId/);
});

test("faq component wraps questions in h2 elements", () => {
  assert.match(faqComponentSource, /<h2>/);
});

test("faq component uses useState for open/close state", () => {
  assert.match(faqComponentSource, /useState/);
});

// ── Homepage integration ─────────────────────────────────────────────────────

test("homepage imports the FAQ component", () => {
  assert.match(homepageSource, /from "@\/components\/faq"/);
  assert.match(homepageSource, /\bFAQ\b/);
});

test("homepage imports faqItems for JSON-LD", () => {
  assert.match(homepageSource, /from "\.\/data\/faq"/);
  assert.match(homepageSource, /\bfaqItems\b/);
});

test("homepage injects a FAQPage JSON-LD script", () => {
  assert.match(homepageSource, /"FAQPage"/);
  assert.match(homepageSource, /mainEntity/);
  assert.match(homepageSource, /faqPageJsonLd/);
});

test("homepage renders FAQ section after Ecosystem", () => {
  const faqIndex = homepageSource.indexOf("<FAQ />");
  const ecosystemIndex = homepageSource.indexOf("<Ecosystem />");
  assert.ok(faqIndex !== -1, "<FAQ /> must be rendered in the homepage");
  assert.ok(ecosystemIndex !== -1, "<Ecosystem /> must be rendered in the homepage");
  assert.ok(faqIndex > ecosystemIndex, "<FAQ /> must appear after <Ecosystem />");
});

test("FAQ section is wrapped in a reveal div", () => {
  // Find the reveal wrapper that contains FAQ (tolerate extra attributes
  // like suppressHydrationWarning on the wrapper)
  const revealFaqMatch = homepageSource.match(/<div className="reveal"[^>]*>\s*<FAQ \/>/);
  assert.ok(revealFaqMatch !== null, "<FAQ /> must be wrapped in a reveal div");
});
