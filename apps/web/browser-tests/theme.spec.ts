import { expect, test, waitForHydration } from "./fixtures";

test.use({ viewport: { width: 1280, height: 800 } });

const panel = (page: import("@playwright/test").Page) => page.locator("details.website-themes");

test("theme panel opens, closes on Escape and on outside click", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  const summary = page.locator("details.website-themes > summary");

  await summary.click();
  await expect(panel(page)).toHaveAttribute("open", /.*/);
  await expect(page.getByRole("button", { name: "Dracula" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel(page)).not.toHaveAttribute("open", /.*/);
  await expect(summary).toBeFocused();

  await summary.click();
  await page.mouse.click(10, 500);
  await expect(panel(page)).not.toHaveAttribute("open", /.*/);
});

test("family and mode survive a reload without hydration errors", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await page.locator("details.website-themes > summary").click();

  await page.getByRole("button", { name: "Dracula" }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-family", "dracula");
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.reload();
  await waitForHydration(page);
  await expect(page.locator("html")).toHaveAttribute("data-family", "dracula");
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.locator(".website-themes > summary")).toContainText("Dracula · light");

  await page.locator("details.website-themes > summary").click();
  await expect(page.getByRole("button", { name: "Dracula" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Switching back to dark persists too.
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.reload();
  await waitForHydration(page);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-family", "dracula");
});

test("the saved family applies before hydration on another page", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await page.locator("details.website-themes > summary").click();
  await page.getByRole("button", { name: "Gruvbox" }).click();
  await page.goto("/compare");
  await expect(page.locator("html")).toHaveAttribute("data-family", "gruvbox");
});
