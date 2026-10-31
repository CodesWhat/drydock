import assert from "node:assert/strict";
import { test } from "node:test";

const behavior = await import("../src/lib/website-behavior.mjs").catch(() => ({}));

test("saved theme families are validated before applying document attributes", () => {
  assert.equal(typeof behavior.getThemeFamily, "function");
  for (const family of ["one-dark", "github", "dracula", "catppuccin", "gruvbox", "ayu"]) {
    assert.equal(behavior.getThemeFamily(family), family);
  }
  for (const invalid of [null, undefined, "", "unknown", "__proto__", "dark", {}]) {
    assert.equal(behavior.getThemeFamily(invalid), "one-dark");
  }
});

test("demo readiness requires the expected origin, exact iframe window and message", () => {
  assert.equal(typeof behavior.isDemoReadyMessage, "function");
  const frame = {};
  const event = {
    origin: "https://demo.getdrydock.com",
    source: frame,
    data: { type: "drydock-demo-ready" },
  };
  assert.equal(behavior.isDemoReadyMessage(event, frame, "https://demo.getdrydock.com"), true);
  assert.equal(
    behavior.isDemoReadyMessage(
      { ...event, origin: "https://demo.getdrydock.com.evil.test" },
      frame,
      "https://demo.getdrydock.com",
    ),
    false,
  );
  assert.equal(
    behavior.isDemoReadyMessage({ ...event, source: {} }, frame, "https://demo.getdrydock.com"),
    false,
  );
  assert.equal(
    behavior.isDemoReadyMessage({ ...event, data: null }, frame, "https://demo.getdrydock.com"),
    false,
  );
  assert.equal(
    behavior.isDemoReadyMessage(
      { ...event, data: { type: "load" } },
      frame,
      "https://demo.getdrydock.com",
    ),
    false,
  );
  assert.equal(
    behavior.isDemoReadyMessage({ ...event, source: null }, null, "https://demo.getdrydock.com"),
    false,
  );
});

test("roadmap keeps planned releases, the active candidate and four earlier releases visible", () => {
  assert.equal(typeof behavior.splitRoadmap, "function");
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({ version: `1.${i}`, status: "released" })),
    { version: "1.8.0-rc.10", status: "released" },
    { version: "1.9", status: "planned" },
    { version: "2.0", status: "planned" },
  ];
  const result = behavior.splitRoadmap(rows, "1.8.0-rc.10");
  assert.deepEqual(
    result.visible.map((row) => row.version),
    ["2.0", "1.9", "1.8.0-rc.10", "1.7", "1.6", "1.5", "1.4"],
  );
  assert.deepEqual(
    result.earlier.map((row) => row.version),
    ["1.3", "1.2", "1.1", "1.0"],
  );
  assert.equal(rows[0].version, "1.0");
  assert.deepEqual(behavior.splitRoadmap([], "none"), { visible: [], earlier: [] });
});

test("the live demo can be framed by both canonical website hosts, without preview-domain access", async () => {
  const { readFile } = await import("node:fs/promises");
  const config = JSON.parse(
    await readFile(new URL("../../demo/vercel.json", import.meta.url), "utf8"),
  );
  const policy = config.headers
    .find((rule) => rule.source === "/(.*)")
    .headers.find((header) => header.key === "Content-Security-Policy").value;
  const ancestors = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("frame-ancestors "));
  assert.equal(
    ancestors,
    "frame-ancestors 'self' https://getdrydock.com https://www.getdrydock.com",
  );
});

test("website and demo deployment configuration permits production only", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["../vercel.json", "../../demo/vercel.json"]) {
    const config = JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
    assert.deepEqual(config.git.deploymentEnabled, { "**": false, main: true });
  }
});

test("the nonce bootstrap restores a valid family before paint and fails safely for invalid or blocked storage", async () => {
  const { runInNewContext } = await import("node:vm");
  assert.equal(typeof behavior.FAMILY_BOOTSTRAP, "string");
  for (const family of [
    "one-dark",
    "github",
    "dracula",
    "catppuccin",
    "gruvbox",
    "ayu",
    "unknown",
    "__proto__",
    null,
  ]) {
    const document = { documentElement: { dataset: { family: "one-dark" } } };
    runInNewContext(behavior.FAMILY_BOOTSTRAP, {
      document,
      localStorage: {
        getItem(key) {
          assert.equal(key, "dd-website-family");
          return family;
        },
      },
    });
    assert.equal(document.documentElement.dataset.family, behavior.getThemeFamily(family));
  }
  const document = { documentElement: { dataset: { family: "one-dark" } } };
  assert.doesNotThrow(() =>
    runInNewContext(behavior.FAMILY_BOOTSTRAP, {
      document,
      localStorage: {
        getItem() {
          throw new Error("Storage disabled");
        },
      },
    }),
  );
  assert.equal(document.documentElement.dataset.family, "one-dark");
});
