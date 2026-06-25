import type { ReactNode } from "react";
import { FooterVariants } from "@/components/lab/footer-variants";
import { SiteBackground } from "@/components/site-background";
import { SiteHeader } from "@/components/site-header";

// Shared marketing shell — ocean (blue) aurora, sticky header, footer.
// Used by the homepage and the /compare route so every marketing page
// shares the same chrome.
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <main data-bg="ocean" className="relative min-h-screen">
      <SiteBackground />
      <div className="relative z-10">
        <SiteHeader />
        {children}
        <FooterVariants />
      </div>
    </main>
  );
}
