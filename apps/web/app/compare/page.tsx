import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title: "Drydock vs Alternatives — Container Update Tool Comparisons",
  description:
    "Compare Drydock to Watchtower, Portainer, Diun, Komodo, Dockge, Dockhand, Dozzle, Ouroboros, and WUD. Feature-by-feature breakdowns for container update monitoring tools.",
  keywords: [
    "watchtower alternative",
    "portainer alternative",
    "diun alternative",
    "container update monitoring comparison",
    "docker update tools",
    "watchtower replacement",
    "watchtower archived",
  ],
  openGraph: {
    title: "Drydock vs Alternatives — Container Update Tool Comparisons",
    description:
      "Compare Drydock to Watchtower, Portainer, Diun, and more. Feature-by-feature breakdowns.",
    url: `${baseUrl}/compare`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drydock vs Alternatives — Container Update Tool Comparisons",
    description: "Compare Drydock to Watchtower, Portainer, Diun, and more.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare`,
  },
};

const tools = [
  {
    name: "Portainer",
    slug: "portainer",
    description:
      "Full container management platform with free CE and paid Business Edition. Compare Drydock's free update monitoring and security scanning to Portainer's paid features.",
    status: "Active",
    statusColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
  },
  {
    name: "Komodo",
    slug: "komodo",
    description:
      "Broad DevOps platform with CI/CD, git deployment, and container management. See how Drydock's focused update monitoring compares.",
    status: "Active",
    statusColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
  },
  {
    name: "Diun",
    slug: "diun",
    description:
      "Lightweight notification-only tool that alerts on image updates but doesn't apply them. See how Drydock adds a UI, auto-updates, and security scanning.",
    status: "Active",
    statusColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
  },
  {
    name: "Dockge",
    slug: "dockge",
    description:
      "Popular compose stack manager focused on editing and deploying compose files. Drydock focuses on update monitoring — they complement each other well.",
    status: "Active",
    statusColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
  },
  {
    name: "Dockhand",
    slug: "dockhand",
    description:
      "Container update tool with Update Guard scanning and git-based deployment. Compare rollback, hooks, and registry support.",
    status: "Active",
    statusColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
  },
  {
    name: "Dozzle",
    slug: "dozzle",
    description:
      "Best-in-class real-time log viewer with SQL querying. Different focus from Drydock — they work great side-by-side.",
    status: "Active",
    statusColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
  },
  {
    name: "WUD",
    slug: "wud",
    description:
      "Drydock's upstream fork (What's Up Docker). See what Drydock adds: 13 more registries, security scanning, agents, audit log, and a TypeScript rewrite.",
    status: "Active",
    statusColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
  },
  {
    name: "Watchtower",
    slug: "watchtower",
    description:
      "The most popular container updater — archived Dec 2025. See how Drydock picks up where Watchtower left off with a web UI, security scanning, and rollback.",
    status: "Archived",
    statusColor: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400",
  },
  {
    name: "Ouroboros",
    slug: "ouroboros",
    description:
      "Python-based auto-updater, unmaintained since ~2020. See how Drydock provides a modern, actively maintained alternative.",
    status: "Unmaintained",
    statusColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400",
  },
];

export default function ComparePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Drydock vs Alternatives — Container Update Tool Comparisons",
    description:
      "Compare Drydock to Watchtower, Portainer, Diun, Komodo, Dockge, Dockhand, Dozzle, Ouroboros, and WUD.",
    url: `${baseUrl}/compare`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: tools.length,
      itemListElement: tools.map((tool, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${baseUrl}/compare/${tool.slug}`,
        name: `${tool.name} vs Drydock`,
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="relative min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-950 dark:to-neutral-900">
        <div className="bg-grid-neutral-200/50 dark:bg-grid-neutral-800/50 fixed inset-0" />

        <div className="relative z-10">
          {/* Hero */}
          <section className="px-4 pt-16 pb-12">
            <div className="mx-auto max-w-4xl">
              <Link
                href="/"
                className="mb-8 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to home
              </Link>

              <div className="relative text-center">
                <div className="pointer-events-none absolute inset-y-[-1.5rem] left-1/2 w-[30rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
                <h1 className="relative mb-4 text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl dark:text-neutral-100">
                  Drydock vs Alternatives
                </h1>
                <p className="relative mx-auto max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
                  Feature-by-feature comparisons with every major container update and management
                  tool. Find out which tool fits your workflow.
                </p>
              </div>
            </div>
          </section>

          {/* Comparison Cards */}
          <section className="px-4 pb-24">
            <div className="mx-auto max-w-4xl">
              <div className="grid gap-4">
                {tools.map((tool) => (
                  <Link
                    key={tool.slug}
                    href={`/compare/${tool.slug}`}
                    className="group rounded-xl border border-neutral-200 bg-white/50 p-5 backdrop-blur-sm transition-all hover:border-neutral-300 hover:bg-white/80 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-neutral-700 dark:hover:bg-neutral-900/80"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex items-center gap-3">
                          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                            {tool.name} vs Drydock
                          </h2>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${tool.statusColor}`}
                          >
                            {tool.status}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400">
                          {tool.description}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-600 dark:group-hover:text-neutral-300" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="px-4 py-8">
            <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Image
                  src="/codeswhat-logo.png"
                  alt="CodesWhat"
                  width={20}
                  height={20}
                  className="dark:invert"
                />
                <span>&copy; {new Date().getFullYear()} CodesWhat. AGPL-3.0 License.</span>
              </div>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}
