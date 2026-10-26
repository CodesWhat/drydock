import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

// The inline reveal script in layout.tsx runs once per full page load. A
// next/link navigation does not re-run the root layout, so `.reveal` nodes
// mounted afterwards must be picked up by a MutationObserver or they stay at
// opacity 0. These tests run the real string against a minimal fake DOM.

const layoutSource = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const literal = layoutSource.match(/const REVEAL_BOOTSTRAP =\s*("(?:[^"\\]|\\.)*");/);
assert.ok(literal, "REVEAL_BOOTSTRAP string literal not found in layout.tsx");
const REVEAL_BOOTSTRAP = JSON.parse(literal[1]);

class FakeElement {
  constructor(classes = []) {
    this.nodeType = 1;
    this.children = [];
    this._classes = new Set(classes);
    this.classList = {
      add: (c) => this._classes.add(c),
      contains: (c) => this._classes.has(c),
    };
  }

  append(child) {
    this.children.push(child);
    return child;
  }

  querySelectorAll(selector) {
    assert.equal(selector, ".reveal");
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.classList.contains("reveal")) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

function run({ reduced = false, readyState = "complete", setup } = {}) {
  const html = new FakeElement();
  const body = new FakeElement();
  html.append(body);
  const listeners = {};
  const ios = [];
  const mos = [];
  const initial = setup ? setup(body) : undefined;

  class FakeIO {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.unobserved = [];
      ios.push(this);
    }
    observe(node) {
      this.observed.push(node);
    }
    unobserve(node) {
      this.unobserved.push(node);
    }
  }
  class FakeMO {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      mos.push(this);
    }
    observe(target, options) {
      this.targets.push({ target, options });
    }
  }

  const sandbox = {
    document: {
      documentElement: html,
      body,
      readyState,
      querySelectorAll: (selector) => html.querySelectorAll(selector),
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
    },
    matchMedia: () => ({ matches: reduced }),
    IntersectionObserver: FakeIO,
    MutationObserver: FakeMO,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(REVEAL_BOOTSTRAP, sandbox);

  return { html, body, ios, mos, listeners, initial };
}

const mutate = (mo, ...nodes) => mo.callback([{ addedNodes: nodes }]);

test("adds the js class to <html>", () => {
  const { html } = run();
  assert.equal(html.classList.contains("js"), true);
});

test("observes initial .reveal nodes and marks them visible on intersect", () => {
  const { initial: x, ios } = run({ setup: (body) => body.append(new FakeElement(["reveal"])) });
  assert.deepEqual(ios[0].observed, [x]);
  assert.equal(x.classList.contains("visible"), false);
  ios[0].callback([{ isIntersecting: true, target: x }]);
  assert.equal(x.classList.contains("visible"), true);
  assert.deepEqual(ios[0].unobserved, [x]);
});

test("does not mark non-intersecting nodes visible", () => {
  const { initial: x, ios } = run({ setup: (body) => body.append(new FakeElement(["reveal"])) });
  ios[0].callback([{ isIntersecting: false, target: x }]);
  assert.equal(x.classList.contains("visible"), false);
});

test("observes .reveal nodes mounted after arming (client-side navigation)", () => {
  const { body, ios, mos } = run();
  assert.equal(mos.length, 1, "a MutationObserver should be armed");
  assert.equal(mos[0].targets[0].target, body);
  assert.equal(mos[0].targets[0].options.childList, true);
  assert.equal(mos[0].targets[0].options.subtree, true);

  const section = new FakeElement(["reveal"]);
  const wrapper = new FakeElement();
  const nested = wrapper.append(new FakeElement(["reveal"]));
  body.append(section);
  body.append(wrapper);
  mutate(mos[0], section, wrapper);

  assert.deepEqual(ios[0].observed, [section, nested]);
  ios[0].callback([{ isIntersecting: true, target: nested }]);
  assert.equal(nested.classList.contains("visible"), true);
});

test("reduced motion shows initial and later-added nodes without an IntersectionObserver", () => {
  const {
    initial: early,
    ios,
    mos,
  } = run({
    reduced: true,
    setup: (body) => body.append(new FakeElement(["reveal"])),
  });
  assert.equal(early.classList.contains("visible"), true);

  const late = new FakeElement(["reveal"]);
  const wrapper = new FakeElement();
  const nested = wrapper.append(new FakeElement(["reveal"]));
  mutate(mos[0], late, wrapper);
  assert.equal(late.classList.contains("visible"), true);
  assert.equal(nested.classList.contains("visible"), true);
  assert.equal(ios.length, 0);
});

test("never observes the same node twice", () => {
  const { body, ios, mos } = run();
  const section = body.append(new FakeElement(["reveal"]));
  mutate(mos[0], section);
  mutate(mos[0], section);
  mutate(mos[0], body);
  assert.deepEqual(ios[0].observed, [section]);
});
