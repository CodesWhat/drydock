import type { ReactNode } from "react";
import { Footer } from "@/components/footer";
import { SiteHeader } from "@/components/site-header";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="website-shell relative min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-neutral-900 focus:shadow-lg dark:focus:bg-neutral-900 dark:focus:text-neutral-100"
      >
        Skip to content
      </a>
      <div className="relative z-10">
        <SiteHeader />
        <main id="main-content">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
