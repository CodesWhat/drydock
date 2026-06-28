import { ChevronRight } from "lucide-react";
import { SectionHeading } from "@/components/section-heading";
import { type Milestone, roadmap } from "@/lib/site-content";

// Locked: Roadmap = the git-graph timeline (newest-first, planned on top).
// Released = filled node, HEAD highlighted, planned = hollow dashed node.
// Rows with more than two items expand inline. Styled like a commit graph for
// the vibe — not literally `git log` output.

const released = roadmap.filter((m) => m.status === "released");
// HEAD release: last released milestone
const headRelease = released[released.length - 1] as Milestone;

function GitItem({ item, isReleased }: { item: string; isReleased: boolean }) {
  return (
    <p
      className={`font-mono text-[11px] leading-relaxed ${
        isReleased
          ? "text-neutral-500 dark:text-neutral-500"
          : "text-neutral-400 dark:text-neutral-700"
      }`}
    >
      <span className="mr-1 text-neutral-300 dark:text-neutral-700">│</span>
      {item}
    </p>
  );
}

function GitLogRow({ milestone }: { milestone: Milestone }) {
  const isReleased = milestone.status === "released";
  const isHead = milestone.version === headRelease.version;
  const preview = milestone.items.slice(0, 2);
  const rest = milestone.items.slice(2);

  const refLine = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {isHead ? (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
          HEAD -&gt; {milestone.version}
        </span>
      ) : (
        <span
          className={`font-mono text-[11px] font-semibold ${
            isReleased
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-neutral-400 dark:text-neutral-600"
          }`}
        >
          {milestone.version}
        </span>
      )}
      <span className="text-sm">{milestone.emoji}</span>
      <span
        className={`text-xs font-medium ${
          isReleased
            ? "text-neutral-800 dark:text-neutral-200"
            : "text-neutral-400 dark:text-neutral-600"
        }`}
      >
        {milestone.title}
      </span>
    </div>
  );

  return (
    <div className={`relative flex gap-4 ${isReleased ? "" : "opacity-80"}`}>
      {/* Graph column */}
      <div className="relative flex w-4 shrink-0 flex-col items-center">
        {/* Node */}
        <div
          className={`relative z-10 mt-1 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 ${
            isHead
              ? "border-emerald-400 bg-emerald-400 ring-2 ring-emerald-400/40 ring-offset-1 dark:ring-offset-neutral-950"
              : isReleased
                ? "border-emerald-600 bg-emerald-600 dark:border-emerald-500 dark:bg-emerald-500"
                : "border-dashed border-neutral-400 bg-transparent dark:border-neutral-600"
          }`}
        />
      </div>

      {/* Content */}
      <div className={`flex-1 pb-4 ${isHead ? "pb-5" : ""}`}>
        {refLine}

        {milestone.items.length > 0 &&
          (rest.length > 0 ? (
            <details className="group mt-1 [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer space-y-0.5">
                {preview.map((item) => (
                  <GitItem key={item} item={item} isReleased={isReleased} />
                ))}
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-neutral-400 transition-colors hover:text-neutral-700 dark:text-neutral-600 dark:hover:text-neutral-300">
                  <span className="text-neutral-300 dark:text-neutral-700">│</span>
                  <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                  <span className="group-open:hidden">+{rest.length} more</span>
                  <span className="hidden group-open:inline">show less</span>
                </span>
              </summary>
              <div className="mt-0.5 space-y-0.5">
                {rest.map((item) => (
                  <GitItem key={item} item={item} isReleased={isReleased} />
                ))}
              </div>
            </details>
          ) : (
            <div className="mt-1 space-y-0.5">
              {preview.map((item) => (
                <GitItem key={item} item={item} isReleased={isReleased} />
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

export function Roadmap() {
  // Newest-first — planned at the top, shipped history flowing down to the root
  const logOrder = [...roadmap].reverse();

  return (
    <section className="border-t border-border/60 py-16">
      <div className="mx-auto max-w-3xl px-4">
        <SectionHeading
          eyebrow="On the horizon"
          title="Roadmap"
          subtitle="Where we've been and where we're headed."
          align="right"
        />

        {/* Legend — above the card so the key is visible as you scroll */}
        <div className="mb-4 flex flex-wrap items-center justify-end gap-x-5 gap-y-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Released
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/40" />
            Current (HEAD)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border-2 border-dashed border-neutral-400" />
            Planned
          </span>
        </div>

        {/* Graph frame */}
        <div className="rounded-xl border border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50">
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
            <span className="ml-2 font-mono text-[11px] text-neutral-400 dark:text-neutral-600">
              roadmap
            </span>
          </div>

          {/* Graph entries */}
          <div className="relative p-4">
            {/* Vertical line connecting nodes */}
            <div className="absolute left-[calc(1rem+0.5rem)] top-4 bottom-4 w-px bg-neutral-200 dark:bg-neutral-800" />

            <div className="space-y-0">
              {logOrder.map((m) => (
                <GitLogRow key={m.version} milestone={m} />
              ))}
            </div>

            {/* Root commit indicator */}
            <div className="flex items-center gap-4 pt-1">
              <div className="flex w-4 shrink-0 justify-center">
                <span className="font-mono text-xs text-neutral-300 dark:text-neutral-700">└</span>
              </div>
              <span className="font-mono text-[11px] text-neutral-300 dark:text-neutral-700">
                (initial commit)
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
