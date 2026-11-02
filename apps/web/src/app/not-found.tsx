import { ArrowLeft, BookOpen, GitCompare } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { NotFoundSearch } from "@/components/not-found-search";
import { Button } from "@/components/ui/button";
import { DOCS_ROOT, SITE_CONFIG } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Page Not Found",
  // No robots entry here: Next adds its own noindex to not-found responses, and
  // a second one produced two robots tags. openGraph replaces the layout's
  // object whole, so it carries its own title and image instead of the
  // homepage's.
  openGraph: {
    title: `Page Not Found | ${SITE_CONFIG.name}`,
    siteName: SITE_CONFIG.name,
    images: [SITE_CONFIG.ogImage],
  },
};

export default function NotFound() {
  return (
    <MarketingShell>
      <section className="website-not-found">
        <Image
          src="/whale.webp"
          alt="Drydock mascot, a blue toy whale"
          width={132}
          height={88}
          loading="lazy"
        />
        <p className="website-eyebrow">Error 404 · Drydock</p>
        <h1>Page not found</h1>
        <p>
          The link is stale or the page moved. Nothing is tracked at this address, so there’s no
          update to roll out.
        </p>
        <NotFoundSearch />
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              Back to Drydock
            </Link>
          </Button>
          <Button variant="outline" className="website-outline-button" asChild>
            <Link href={DOCS_ROOT}>
              <BookOpen aria-hidden="true" />
              Docs
            </Link>
          </Button>
          <Button variant="outline" className="website-outline-button" asChild>
            <Link href="/compare">
              <GitCompare aria-hidden="true" />
              Compare
            </Link>
          </Button>
        </div>
      </section>
    </MarketingShell>
  );
}
