import { expect, test, waitForHydration } from "./fixtures";

test.use({ viewport: { width: 1280, height: 800 } });

test("demo shows a failure state with a way out when the demo origin is unreachable", async ({
  page,
  diagnostics,
}) => {
  // The fixture refuses every request to the demo origin. The browser reports
  // that as a failed resource, which is the point of this test.
  diagnostics.ignoreConsole(/Failed to load resource|demo\.getdrydock\.com|Frame load/i);
  // The component gives the frame 20s to say it's ready. Run the page's own
  // timers on a fake clock so the test doesn't wait for real time.
  await page.clock.install();
  await page.goto("/");
  await waitForHydration(page);

  const demo = page.locator("#demo");
  await demo.scrollIntoViewIfNeeded();
  const status = demo.locator(".website-demo-bar [role=status]");
  await expect(status).toHaveText(/Loading demo/);
  // The 20s timer starts when the frame mounts, so wait for it first.
  await expect(demo.locator("iframe")).toBeAttached();

  await page.clock.runFor(21_000);
  await expect(status).toHaveText(/Couldn.t connect/);
  await expect(demo.getByText(/live demo couldn.t load/i)).toBeVisible();
  await expect(demo.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(demo.getByRole("link", { name: "Open demo directly" })).toHaveAttribute(
    "href",
    /^https:\/\/demo\.getdrydock\.com\//,
  );

  // Retrying goes back to loading, then fails again.
  await demo.getByRole("button", { name: "Try again" }).click();
  await expect(status).toHaveText(/Loading demo/);
  await expect(demo.locator("iframe")).toBeAttached();
  await page.clock.runFor(21_000);
  await expect(status).toHaveText(/Couldn.t connect/);
});
