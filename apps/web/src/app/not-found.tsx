import type { Metadata } from "next";
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
      <section className="px-4 pt-16 pb-12">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl dark:text-neutral-100">
            Page not found
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
            This page does not exist. It may have been moved or the link may be out of date.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/">Go to homepage</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/docs">Browse docs</Link>
            </Button>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
