const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

test('targets the bound anchor without a physical pointer that layout shifts can retarget', async () => {
  const { showTooltipFor } = await import('../playwright/helpers/tooltip-target.mjs');
  const events = [];
  const anchor = {
    async dispatchEvent(event) {
      events.push(event);
    },
    async hover() {
      assert.fail('physical hover can move onto a different row during a layout shift');
    },
  };

  await showTooltipFor(anchor);

  assert.deepEqual(events, ['mouseenter']);
});

test('same-tag digest tooltip assertions target both bound anchors directly', () => {
  const rawHoverPattern = /\.hover\s*\(/;
  const source = readFileSync(join(__dirname, '../playwright/v16-modes-pins.spec.ts'), 'utf8');
  const digestTest = source.slice(
    source.indexOf("test('#498 explains same-tag digest changes"),
    source.indexOf("test('#498 keeps Host visible"),
  );

  assert.match('await anchor.hover({ force: true });', rawHoverPattern);
  assert.equal(digestTest.match(/showTooltipFor\(/g)?.length, 2);
  assert.doesNotMatch(digestTest, rawHoverPattern);
});
