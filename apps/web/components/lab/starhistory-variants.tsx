import { GithubIcon } from "@/components/github-icon";
import { SectionHeading } from "@/components/section-heading";
import { GITHUB_URL } from "@/lib/site-config";

// Locked: Star History = clean framed card, title above the chart (left-aligned).

const DARK_SRC =
  "https://api.star-history.com/svg?repos=CodesWhat/drydock&type=timeline&theme=dark&legend=top-left";
const LIGHT_SRC =
  "https://api.star-history.com/svg?repos=CodesWhat/drydock&type=timeline&legend=top-left";
const CHART_HREF = "https://www.star-history.com/#CodesWhat/drydock&type=timeline&legend=top-left";

function StarChart({ className }: { className?: string }) {
  return (
    <a href={CHART_HREF} target="_blank" rel="noopener" className={className}>
      {/* Swap on the .dark class (theme toggle), not prefers-color-scheme */}
      <img src={LIGHT_SRC} alt="Star History Chart" className="w-full dark:hidden" />
      <img src={DARK_SRC} alt="Star History Chart" className="hidden w-full dark:block" />
    </a>
  );
}

function GithubCta({ label = "Star on GitHub" }: { label?: string }) {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white/60 px-5 py-2.5 text-sm font-medium text-neutral-900 backdrop-blur-sm transition-all hover:border-neutral-300 hover:bg-white/90 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-100 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/90"
    >
      <GithubIcon className="h-4 w-4" />
      {label}
    </a>
  );
}

export function StarHistoryVariants() {
  return (
    <section className="border-t border-border/60 py-16">
      <div className="mx-auto max-w-4xl px-4">
        <SectionHeading
          eyebrow="Community"
          title="Star History"
          subtitle="Growing every week — join us on GitHub."
          align="left"
        />

        <StarChart className="block overflow-hidden rounded-2xl border border-neutral-200 bg-white/50 backdrop-blur-sm transition-all duration-300 hover:border-neutral-300 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-neutral-700" />

        <div className="mt-6 flex">
          <GithubCta />
        </div>
      </div>
    </section>
  );
}
