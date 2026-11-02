import { FullSearchTrigger, SearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import Image from "next/image";
import Link from "next/link";
import { HeaderNavLinks } from "@/components/header-nav";
import { MobileNavigation } from "@/components/mobile-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { iconButtonCn } from "@/lib/class-names";
import { SITE_CONFIG } from "@/lib/site-config";

export function SiteHeader({
  maxWidthClassName = "max-w-6xl",
  showSearch = false,
}: {
  maxWidthClassName?: string;
  showSearch?: boolean;
}) {
  return (
    <header className="website-header">
      <div className={`website-wrap website-header-inner ${showSearch ? maxWidthClassName : ""}`}>
        <Link href="/" className="website-brand" aria-label="Drydock home">
          <Image src="/whale.webp" alt="" width={43} height={29} />
          <span>{SITE_CONFIG.name}</span>
        </Link>
        <nav className="website-nav" aria-label="Main navigation">
          {showSearch && (
            <>
              {/* Compact search lives in the header (sidebar search is disabled in DocsShell).
                  Full bar on desktop, icon-only on mobile — both open the fumadocs search dialog. */}
              <SearchTrigger className={`sm:hidden ${iconButtonCn}`} />
              <FullSearchTrigger className="me-1 hidden h-9 w-44 sm:inline-flex lg:w-56" />
            </>
          )}
          <HeaderNavLinks />
          <ThemeToggle />
          <MobileNavigation />
        </nav>
      </div>
    </header>
  );
}
