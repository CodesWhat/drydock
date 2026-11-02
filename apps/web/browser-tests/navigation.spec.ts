import { expect, test, waitForHydration } from "./fixtures";

test.describe("header navigation (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("links to Docs, Compare and GitHub, and marks the current section", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const docs = nav.getByRole("link", { name: "Docs" });
    const compare = nav.getByRole("link", { name: "Compare" });
    const github = nav.getByRole("link", { name: "GitHub" });

    await expect(docs).not.toHaveAttribute("aria-current", "page");
    await expect(compare).not.toHaveAttribute("aria-current", "page");
    await expect(github).toHaveAttribute("target", "_blank");
    await expect(github).toHaveAttribute("rel", /noopener/);

    await compare.click();
    await expect(page).toHaveURL(/\/compare$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(compare).toHaveAttribute("aria-current", "page");
    await expect(docs).not.toHaveAttribute("aria-current", "page");

    await docs.click();
    await expect(page).toHaveURL(/\/docs\//);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Docs" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("keeps Compare current on a compare subpage", async ({ page }) => {
    await page.goto("/compare/watchtower");
    await waitForHydration(page);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Compare" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("brand link returns home", async ({ page }) => {
    await page.goto("/compare");
    await page.getByRole("link", { name: "Drydock home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
