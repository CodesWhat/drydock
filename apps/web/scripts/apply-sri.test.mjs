import assert from "node:assert/strict";
import { test } from "node:test";

import { applySriToHtml } from "./apply-sri.mjs";

test("applySriToHtml adds integrity and crossorigin to _next scripts and stylesheets", () => {
  const html = [
    '<link rel="stylesheet" href="/_next/static/css/main.css">',
    '<script src="/_next/static/chunks/app.js" async=""></script>',
  ].join("");

  const manifest = {
    "static/css/main.css": "sha384-csshash",
    "static/chunks/app.js": "sha384-jshash",
  };

  const result = applySriToHtml(html, manifest);

  assert.match(
    result.html,
    /<link rel="stylesheet" href="\/_next\/static\/css\/main\.css" integrity="sha384-csshash" crossorigin="anonymous">/,
  );
  assert.match(
    result.html,
    /<script src="\/_next\/static\/chunks\/app\.js" async="" integrity="sha384-jshash" crossorigin="anonymous"><\/script>/,
  );
  assert.equal(result.updatedTags, 2);
});

test("applySriToHtml leaves tags unchanged when integrity already exists", () => {
  const html =
    '<script src="/_next/static/chunks/app.js" integrity="sha384-existing" crossorigin="anonymous"></script>';
  const manifest = {
    "static/chunks/app.js": "sha384-jshash",
  };

  const result = applySriToHtml(html, manifest);

  assert.equal(result.html, html);
  assert.equal(result.updatedTags, 0);
});

test("applySriToHtml ignores non-_next assets", () => {
  const html = '<script src="https://example.com/app.js"></script>';
  const manifest = {
    "static/chunks/app.js": "sha384-jshash",
  };

  const result = applySriToHtml(html, manifest);

  assert.equal(result.html, html);
  assert.equal(result.updatedTags, 0);
});

test("applySriToHtml resolves URL-encoded _next chunk paths", () => {
  const html =
    '<script src="/_next/static/chunks/app/docs/%5B%5B...slug%5D%5D/page.js" async=""></script>';
  const manifest = {
    "static/chunks/app/docs/[[...slug]]/page.js": "sha384-docshash",
  };

  const result = applySriToHtml(html, manifest);

  assert.match(result.html, /integrity="sha384-docshash"/);
  assert.equal(result.updatedTags, 1);
});
