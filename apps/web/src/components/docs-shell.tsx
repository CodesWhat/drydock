import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ComponentProps, ReactNode } from "react";
import { Footer } from "@/components/footer";
import { SiteHeader } from "@/components/site-header";

type PageTree = ComponentProps<typeof DocsLayout>["tree"];

// Shared docs chrome — the docs counterpart to MarketingShell. Wraps the fumadocs
// docs body in the Drydock SiteHeader + Footer (full-width, SWR-style) and
// turns off fumadocs' own navbar/theme toggle so the SiteHeader owns nav + dark mode.
// Reusable across our docs sites: pass each site's own page tree.
export function DocsShell({ tree, children }: { tree: PageTree; children: ReactNode }) {
  // Header + footer share the fumadocs --fd-layout-width so they line up with the docs
  // body and center as one bounded column (margins on a wide monitor, full-width on laptops).
  // Search moves into the SiteHeader (showSearch); the sidebar's own search is disabled.
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidthClassName="max-w-[var(--fd-layout-width)]" showSearch />
      <DocsLayout
        tree={tree}
        nav={{ enabled: false }}
        themeSwitch={{ enabled: false }}
        searchToggle={{ enabled: false }}
      >
        {children}
      </DocsLayout>
      <Footer maxWidthClassName="max-w-[var(--fd-layout-width)]" />
    </div>
  );
}
