import { ChevronRight } from "lucide-react";
import { SectionHeading } from "@/components/section-heading";
import { getRoadmapHead, type Milestone, roadmap } from "@/lib/site-content";
import { splitRoadmap } from "@/lib/website-behavior.mjs";

// Locked: Roadmap = the git-graph timeline (newest-first, planned on top).
// Released = filled node, HEAD highlighted, planned = hollow dashed node.
// Rows with more than two items expand inline. Styled like a commit graph for
// the vibe — not literally `git log` output.

// HEAD follows the newest active candidate when an older RC train is retained.
const headRelease = getRoadmapHead() as Milestone;

function GitItem({ item, isReleased }: { item: string; isReleased: boolean }) {
  return (
    <p
      className={`font-mono text-xs leading-relaxed ${
        isReleased
          ? "text-[var(--tx-sec)] dark:text-[var(--tx-sec)]"
          : "text-[var(--tx-sec)] dark:text-[var(--tx-sec)]"
      }`}
    >
      <span className="mr-1 text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">│</span>
      {item}
    </p>
  );
}

function GitLogRow({ milestone }: { milestone: Milestone }) {
  const isHead = milestone.version === headRelease.version;
  const isReleased = milestone.status === "released" || isHead;
  const preview = milestone.items.slice(0, 2);
  const rest = milestone.items.slice(2);

  const refLine = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {isHead ? (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs font-bold text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
          HEAD -&gt; {milestone.version}
        </span>
      ) : (
        <span
          className={`font-mono text-xs font-semibold ${
            isReleased
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-[var(--tx-sec)] dark:text-[var(--tx-sec)]"
          }`}
        >
          {milestone.version}
        </span>
      )}
      <span
        className={`text-xs font-medium ${
          isReleased
            ? "text-[var(--dd-text)] dark:text-[var(--dd-text)]"
            : "text-[var(--tx-sec)] dark:text-[var(--tx-sec)]"
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
                : "border-dashed border-[var(--dd-border-strong)] bg-transparent border-[var(--dd-border-strong)]"
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
                <span className="inline-flex items-center gap-1 font-mono text-xs text-[var(--tx-sec)] transition-colors hover:text-[var(--dd-text)] dark:text-[var(--tx-sec)] dark:hover:text-[var(--tx-sec)]">
                  <span className="text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">│</span>
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
  const { visible, earlier } = splitRoadmap(roadmap, headRelease.version);

  return (
    <section id="roadmap" className="website-section website-section--split">
      <div className="website-wrap website-section-grid">
        <SectionHeading
          eyebrow="On the horizon"
          title="Roadmap"
          subtitle="Where we've been and where we're headed."
          align="right"
        />
        <div className="website-section-main">
          {/* Legend — above the card so the key is visible as you scroll */}
          <div className="mb-4 flex flex-wrap items-center justify-end gap-x-5 gap-y-1.5 text-xs text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Released
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/40" />
              Current (HEAD)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border-2 border-dashed border-[var(--dd-border-strong)]" />
              Planned
            </span>
          </div>

          {/* Graph frame */}
          <div className="rounded-[4px] border border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)]">
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b border-[var(--dd-border-strong)] px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
              <span className="ml-2 font-mono text-xs text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                roadmap
              </span>
            </div>

            {/* Graph entries */}
            <div className="relative p-4">
              {/* Vertical line connecting nodes */}
              <div className="absolute left-[calc(1rem+0.5rem)] top-4 bottom-4 w-px bg-[var(--dd-bg-card)]" />

              <div className="space-y-0">
                {visible.map((m: Milestone) => (
                  <GitLogRow key={m.version} milestone={m} />
                ))}
                {earlier.length > 0 ? (
                  <details className="website-earlier-releases group">
                    <summary>
                      <span className="group-open:hidden">
                        Show {earlier.length} earlier releases
                      </span>
                      <span className="hidden group-open:inline">Hide earlier releases</span>
                    </summary>
                    {earlier.map((milestone: Milestone) => (
                      <GitLogRow key={milestone.version} milestone={milestone} />
                    ))}
                  </details>
                ) : null}
              </div>

              {/* Root commit indicator */}
              <div className="flex items-center gap-4 pt-1">
                <div className="flex w-4 shrink-0 justify-center">
                  <span className="font-mono text-xs text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                    └
                  </span>
                </div>
                <span className="font-mono text-xs text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                  (initial commit)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
