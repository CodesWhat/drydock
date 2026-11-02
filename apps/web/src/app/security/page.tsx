import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { MarketingShell } from "@/components/marketing-shell";
import { ADVISORIES } from "@/lib/advisories";
import { BASE_URL, DOCS_ROOT, SITE_CONFIG } from "@/lib/site-config";
import { buildSecurityIndexJsonLd } from "@/lib/structured-data";

const TITLE = "Drydock Security Advisories";
const DESCRIPTION =
  "Security advisories for Drydock, including how upstream supply chain incidents affect it, and the hardening guide for running it.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | ${SITE_CONFIG.name}` },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${BASE_URL}/security`,
    siteName: SITE_CONFIG.name,
    locale: SITE_CONFIG.locale,
    type: "website",
    images: [{ url: SITE_CONFIG.ogImage, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    creator: SITE_CONFIG.twitterCreator,
    images: [SITE_CONFIG.ogImage],
  },
  alternates: { canonical: `${BASE_URL}/security` },
};

export default function SecurityIndexPage() {
  return (
    <>
      <JsonLd data={buildSecurityIndexJsonLd(ADVISORIES)} />
      <MarketingShell>
        <section className="pt-16 pb-24">
          <div className="website-wrap">
            <nav aria-label="Breadcrumb" className="website-breadcrumb">
              <Link href="/">Drydock</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">Security</span>
            </nav>
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-[var(--dd-text)] sm:text-5xl dark:text-[var(--dd-text)]">
              Security advisories
            </h1>
            <p className="mb-10 max-w-2xl text-lg text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
              What we publish when something upstream affects, or might affect, Drydock. For
              hardening a deployment, see the{" "}
              <Link href={`${DOCS_ROOT}/guides/security`} className="underline underline-offset-4">
                security guide
              </Link>
              .
            </p>
            <h2 className="sr-only">Advisories</h2>
            <ul className="grid gap-4">
              {ADVISORIES.map((advisory) => (
                <li
                  key={advisory.slug}
                  className="rounded-[4px] border border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)] p-6"
                >
                  <h3 className="text-xl font-semibold text-[var(--dd-text)] dark:text-[var(--dd-text)]">
                    <Link
                      href={`/security/${advisory.slug}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {advisory.title}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                    {advisory.status} · Published{" "}
                    <time dateTime={advisory.datePublished}>{advisory.datePublished}</time> ·
                    Updated <time dateTime={advisory.dateModified}>{advisory.dateModified}</time>
                  </p>
                  <p className="mt-3 text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                    {advisory.summary}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </MarketingShell>
    </>
  );
}
