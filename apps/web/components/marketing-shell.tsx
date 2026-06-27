import type { ReactNode } from "react";
import { FooterVariants } from "@/components/lab/footer-variants";
import { SiteBackground } from "@/components/site-background";
import { SiteHeader } from "@/components/site-header";

// Shared marketing shell — ocean (blue) aurora, sticky header, footer.
// Used by the homepage and the /compare route so every marketing page
// shares the same chrome.
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div data-bg="ocean" data-aurora-motion="true" className="relative min-h-screen">
      <SiteBackground />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-neutral-900 focus:shadow-lg dark:focus:bg-neutral-900 dark:focus:text-neutral-100"
      >
        Skip to content
      </a>
      <div className="relative z-10">
        <SiteHeader />
        <main id="main-content">{children}</main>
        <FooterVariants />
      </div>
    </div>
  );
}
