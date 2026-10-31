import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: {
    index: false,
    follow: false,
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
        <FullSearchTrigger
          className="website-not-found-search"
          aria-label="Search the Drydock docs"
        />
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">Back to Drydock</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/docs">Docs</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/compare">Compare</Link>
          </Button>
        </div>
      </section>
    </MarketingShell>
  );
}
