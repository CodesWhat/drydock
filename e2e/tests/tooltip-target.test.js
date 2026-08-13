const assert = require('node:assert/strict');
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
