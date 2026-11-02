import { test as base, expect } from "@playwright/test";

const DEMO_ORIGIN = "https://demo.getdrydock.com";

const PIXEL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="none"/></svg>';

type Diagnostics = {
  /** Console errors matching this are expected in the current test. */
  ignoreConsole: (pattern: RegExp) => void;
};

/**
 * Every test gets the same guard rails:
 * - no request leaves the machine (third-party stats, badges, charts and
 *   analytics are stubbed; the demo origin is refused), so nothing flakes on
 *   an outside service;
 * - CSP violations, uncaught page errors and console errors (which is where
 *   React reports hydration mismatches) fail the test.
 */
export const test = base.extend<{ diagnostics: Diagnostics }>({
  diagnostics: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
      const problems: string[] = [];
      const ignored: RegExp[] = [];

      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          // Surfaced through console.error so the listener below sees it.
          console.error(
            `CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`,
          );
        });
      });

      await page.route(
        (url) => url.origin !== origin,
        async (route) => {
          const request = route.request();
          if (request.url().startsWith(DEMO_ORIGIN)) return route.abort("connectionrefused");
          if (request.resourceType() === "image") {
            return route.fulfill({ status: 200, contentType: "image/svg+xml", body: PIXEL_SVG });
          }
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: "{}",
          });
        },
      );

      page.on("console", (message) => {
        if (message.type() === "error") {
          problems.push(`console.error: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

      await use({ ignoreConsole: (pattern) => ignored.push(pattern) });

      const unexpected = problems.filter((problem) => !ignored.some((p) => p.test(problem)));
      expect(unexpected, "console errors, page errors or CSP violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Resolves once React has hydrated: the theme button swaps "Theme" for "<family> · <mode>". */
export async function waitForHydration(page: import("@playwright/test").Page) {
  await expect(page.locator(".website-themes > summary")).toContainText("·");
}

export async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}
