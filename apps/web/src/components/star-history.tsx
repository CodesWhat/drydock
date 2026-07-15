import { GithubIcon } from "@/components/github-icon";
import { SectionHeading } from "@/components/section-heading";
import { StarHistoryChart } from "@/components/star-history-chart";
import { GITHUB_URL } from "@/lib/site-config";

// Locked: Star History = clean framed card, title above the chart (left-aligned).

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

export function StarHistory() {
  return (
    <section className="border-t border-border/60 py-16">
      <div className="mx-auto max-w-4xl px-4">
        <SectionHeading
          eyebrow="Community"
          title="Star History"
          subtitle="Growing every week — join us on GitHub."
          align="left"
        />

        <StarHistoryChart className="block overflow-hidden rounded-2xl border border-neutral-200 bg-white/50 backdrop-blur-sm transition-all duration-300 hover:border-neutral-300 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-neutral-700" />

        <div className="mt-6 flex">
          <GithubCta />
        </div>
      </div>
    </section>
  );
}
