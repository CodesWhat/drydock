import { FullSearchTrigger, SearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import Image from "next/image";
import Link from "next/link";
import { GithubIcon } from "@/components/github-icon";
import { ThemeToggle } from "@/components/theme-toggle";

const GITHUB = "https://github.com/CodesWhat/drydock";

const navLink =
  "text-sm text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100";

const iconButton =
  "rounded-full p-2 text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

export function SiteHeader({
  maxWidthClassName = "max-w-6xl",
  showSearch = false,
}: {
  maxWidthClassName?: string;
  showSearch?: boolean;
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-white/70 backdrop-blur-md dark:bg-neutral-950/70">
      <div className={`mx-auto flex h-14 items-center justify-between px-4 ${maxWidthClassName}`}>
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/whale-logo.png" alt="" width={43} height={43} className="dark:invert" />
          <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Drydock
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {showSearch && (
            <>
              {/* Compact search lives in the header (sidebar search is disabled in DocsShell).
                  Full bar on desktop, icon-only on mobile — both open the fumadocs search dialog. */}
              <SearchTrigger className={`sm:hidden ${iconButton}`} />
              <FullSearchTrigger className="me-1 hidden h-9 w-44 sm:inline-flex lg:w-56" />
            </>
          )}
          <Link href="/docs" className={`hidden px-3 py-2 sm:inline-block ${navLink}`}>
            Docs
          </Link>
          <Link href="/compare" className={`hidden px-3 py-2 sm:inline-block ${navLink}`}>
            Compare
          </Link>
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className={iconButton}
          >
            <GithubIcon className="h-5 w-5" />
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
