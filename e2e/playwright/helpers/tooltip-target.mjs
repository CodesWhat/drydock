/** @param {import('@playwright/test').Locator} anchor */
async function showTooltipFor(anchor) {
  await anchor.dispatchEvent('mouseenter');
}

export { showTooltipFor };
