import { expect, test, waitForHydration } from "./fixtures";

test.use({ viewport: { width: 1280, height: 800 } });

test("FAQ items open and close with click and with Enter", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  const section = page.locator("section", { hasText: "Frequently asked questions" });
  const buttons = section.locator("h3 > button");
  expect(await buttons.count()).toBeGreaterThan(1);

  const first = buttons.nth(0);
  const second = buttons.nth(1);
  const firstAnswer = page.locator(`#${(await first.getAttribute("aria-controls")) ?? ""}`);
  const secondAnswer = page.locator(`#${(await second.getAttribute("aria-controls")) ?? ""}`);

  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(firstAnswer).toBeHidden();

  await first.scrollIntoViewIfNeeded();
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(firstAnswer).toBeVisible();

  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(firstAnswer).toBeHidden();

  await second.focus();
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(secondAnswer).toBeVisible();

  // Opening another item closes the previous one.
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(second).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "false");
});
