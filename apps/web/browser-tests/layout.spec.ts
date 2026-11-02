import { expect, horizontalOverflow, test, waitForHydration } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

const pages = [
  ["home", "/"],
  ["compare", "/compare"],
  ["compare subpage", "/compare/watchtower"],
  ["docs", "/docs"],
  ["security", "/security"],
] as const;

for (const [name, path] of pages) {
  test(`${name} has no horizontal overflow at 375px`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.ok()).toBe(true);
    await page.waitForLoadState("load");
    expect(await horizontalOverflow(page)).toBe(0);
  });
}

test("404 has no horizontal overflow at 375px", async ({ page, diagnostics }) => {
  // The browser logs the 404 document itself as a failed resource.
  diagnostics.ignoreConsole(/status of 404/);
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await waitForHydration(page);
  expect(await horizontalOverflow(page)).toBe(0);
});
