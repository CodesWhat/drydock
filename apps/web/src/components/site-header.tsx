import Image from "next/image";
import Link from "next/link";
import { HeaderNavLinks } from "@/components/header-nav";
import { MobileNavigation } from "@/components/mobile-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { SITE_CONFIG } from "@/lib/site-config";

export function SiteHeader({
  maxWidthClassName = "max-w-6xl",
  variant = "marketing",
}: {
  maxWidthClassName?: string;
  variant?: "marketing" | "docs";
}) {
  // The docs header is deliberately bare (logo, Docs, GitHub). Search and the theme
  // picker live in the fumadocs sidebar there; see DocsShell.
  const docs = variant === "docs";
  return (
    <header className="website-header">
      <div className={`website-wrap website-header-inner ${docs ? maxWidthClassName : ""}`}>
        <Link href="/" className="website-brand" aria-label="Drydock home">
          <Image src="/whale.webp" alt="" width={43} height={29} />
          <span>{SITE_CONFIG.name}</span>
        </Link>
        <nav className="website-nav" aria-label="Main navigation">
          <HeaderNavLinks showCompare={!docs} />
          {!docs && <ThemeToggle />}
          <MobileNavigation variant={variant} />
        </nav>
      </div>
    </header>
  );
}
