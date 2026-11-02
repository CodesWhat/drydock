import { FullSearchTrigger, SearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import Image from "next/image";
import Link from "next/link";
import { GithubIcon } from "@/components/github-icon";
import { MobileNavigation } from "@/components/mobile-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { TrackedLink } from "@/components/tracked-link";
import { iconButtonCn } from "@/lib/class-names";
import { DOCS_ROOT, GITHUB_URL, SITE_CONFIG } from "@/lib/site-config";

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
          <TrackedLink
            href={DOCS_ROOT}
            ctaId="docs_root"
            placement="header"
            className="website-nav-link"
          >
            Docs
          </TrackedLink>
          <Link href="/compare" className="website-nav-link">
            Compare
          </Link>
          <TrackedLink
            href={GITHUB_URL}
            ctaId="github_repository"
            placement="header"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className={iconButtonCn}
          >
            <GithubIcon className="h-5 w-5" />
          </TrackedLink>
          <ThemeToggle />
          <MobileNavigation />
        </nav>
      </div>
    </header>
  );
}
