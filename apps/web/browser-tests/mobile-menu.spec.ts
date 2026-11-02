import { expect, test, waitForHydration } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

const menu = (page: import("@playwright/test").Page) => page.locator("details.website-mobile-nav");
const summary = (page: import("@playwright/test").Page) =>
  page.locator("details.website-mobile-nav > summary");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
});

test("desktop links collapse into the menu at 375px", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Compare", exact: true })).toBeHidden();
  await expect(summary(page)).toBeVisible();
  await expect(menu(page)).not.toHaveAttribute("open", /.*/);
});

test("opens and closes with the pointer", async ({ page }) => {
  await summary(page).click();
  await expect(menu(page)).toHaveAttribute("open", /.*/);
  const compare = page.locator(".website-mobile-panel").getByRole("link", { name: "Compare" });
  await expect(compare).toBeVisible();

  // Tapping the summary again closes it.
  await summary(page).click();
  await expect(menu(page)).not.toHaveAttribute("open", /.*/);
  await expect(compare).toBeHidden();

  // Tapping anywhere outside closes it.
  await summary(page).click();
  await expect(compare).toBeVisible();
  await page.mouse.click(20, 700);
  await expect(menu(page)).not.toHaveAttribute("open", /.*/);
});

test("choosing a link navigates and closes the menu", async ({ page }) => {
  await summary(page).click();
  await page.locator(".website-mobile-panel").getByRole("link", { name: "Compare" }).click();
  await expect(page).toHaveURL(/\/compare$/);
  await expect(menu(page)).not.toHaveAttribute("open", /.*/);
  await summary(page).click();
  await expect(
    page.locator(".website-mobile-panel").getByRole("link", { name: "Compare" }),
  ).toHaveAttribute("aria-current", "page");
});

for (const key of ["Enter", "Space"]) {
  test(`opens with ${key} and closes with Escape, returning focus to the button`, async ({
    page,
  }) => {
    await summary(page).focus();
    await expect(summary(page)).toBeFocused();
    await page.keyboard.press(key);
    await expect(menu(page)).toHaveAttribute("open", /.*/);

    await page.keyboard.press("Escape");
    await expect(menu(page)).not.toHaveAttribute("open", /.*/);
    await expect(summary(page)).toBeFocused();
  });
}

test("a menu link is reachable and activatable by keyboard", async ({ page }) => {
  await summary(page).focus();
  await page.keyboard.press("Enter");
  const first = page.locator(".website-mobile-panel a").first();
  await first.focus();
  await expect(first).toBeFocused();
  await page.locator(".website-mobile-panel").getByRole("link", { name: "Compare" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/compare$/);
});
