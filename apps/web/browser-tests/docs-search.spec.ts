import { expect, test } from "./fixtures";

test.use({ viewport: { width: 1280, height: 800 } });

test("docs search opens, returns results and closes on Escape", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/docs");
  const trigger = page.locator("[data-search-full]").first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("combobox").or(dialog.locator("input")).first();
  await expect(input).toBeFocused();
  await input.fill("registry");
  // The first query on a cold server builds the search index, which can take a while.
  await expect(dialog.getByRole("option").first()).toBeVisible({ timeout: 45_000 });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("docs search opens from the 404 page", async ({ page, diagnostics }) => {
  diagnostics.ignoreConsole(/status of 404/);
  await page.goto("/missing-page");
  await page.getByRole("button", { name: "Search the Drydock docs" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
