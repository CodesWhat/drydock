import { ArrowRight, Check, Minus, X } from "lucide-react";
import Link from "next/link";
import { ComparisonCellIcon } from "@/components/comparison-cell-icon";
import { SectionHeading } from "@/components/section-heading";
import { SITE_CONFIG } from "@/lib/site-config";

// Locked: Compare = the mini comparison table teaser.

type FeatureValue = "yes" | "no" | "partial";

interface FeatureRow {
  label: string;
  drydock: FeatureValue;
  watchtower: FeatureValue;
  diun: FeatureValue;
  portainer: FeatureValue;
}

const featureRows: FeatureRow[] = [
  { label: "Web UI", drydock: "yes", watchtower: "no", diun: "no", portainer: "yes" },
  {
    label: "Update notifications",
    drydock: "yes",
    watchtower: "yes",
    diun: "yes",
    portainer: "partial",
  },
  {
    label: "Multi-registry support",
    drydock: "yes",
    watchtower: "partial",
    diun: "partial",
    portainer: "partial",
  },
  {
    label: "Vulnerability scanning",
    drydock: "yes",
    watchtower: "no",
    diun: "no",
    portainer: "no",
  },
  { label: "Dry-run + rollback", drydock: "yes", watchtower: "no", diun: "no", portainer: "no" },
  {
    label: "Distributed agents",
    drydock: "yes",
    watchtower: "no",
    diun: "no",
    portainer: "partial",
  },
];

function ViewAllLink() {
  return (
    <Link
      href="/compare"
      className="group inline-flex items-center gap-2 rounded-lg border border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)] px-6 py-3 font-medium text-[var(--dd-text)] transition-all hover:border-[var(--dd-border-strong)] hover:bg-[var(--dd-bg-card)] dark:text-[var(--dd-text)] dark:hover:border-[var(--dd-border-strong)] dark:hover:bg-[var(--dd-bg-card)]"
    >
      View all comparisons
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

const tools = [SITE_CONFIG.name, "Portainer", "Diun", "Watchtower"] as const;
type Tool = (typeof tools)[number];

function cellValue(row: FeatureRow, tool: Tool): FeatureValue {
  const map: Record<Tool, FeatureValue> = {
    [SITE_CONFIG.name]: row.drydock,
    Watchtower: row.watchtower,
    Diun: row.diun,
    Portainer: row.portainer,
  };
  return map[tool];
}

export function CompareSection() {
  return (
    <section className="website-section website-section--centered">
      <div className="website-wrap">
        <SectionHeading
          eyebrow={`Why ${SITE_CONFIG.name}`}
          title="How we compare"
          subtitle="A quick look at what we support that Portainer, Diun, and others don't."
          align="right"
        />

        <div className="overflow-hidden rounded-[4px] border border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)]">
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The labelled overflow region needs keyboard focus for horizontal scrolling. */}
          <section className="overflow-x-auto" aria-label="Feature comparison" tabIndex={0}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--dd-border-strong)]">
                  <th className="px-5 py-3 text-left font-medium text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                    Feature
                  </th>
                  {tools.map((tool) => (
                    <th
                      key={tool}
                      className={[
                        "px-4 py-3 text-center font-semibold",
                        tool === SITE_CONFIG.name
                          ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
                          : "text-[var(--tx-sec)] dark:text-[var(--tx-sec)]",
                      ].join(" ")}
                    >
                      {tool}
                      {tool === "Watchtower" && (
                        <span className="mt-0.5 block text-xs font-normal uppercase tracking-wide text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                          Archived
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {featureRows.map((row, i) => (
                  <tr
                    key={row.label}
                    className={[
                      "border-b border-[var(--dd-border-strong)] last:border-0",
                      i % 2 === 1 ? "bg-[var(--dd-bg-sidebar)]" : "",
                    ].join(" ")}
                  >
                    <td className="px-5 py-3 text-[var(--dd-text)] dark:text-[var(--tx-sec)]">
                      {row.label}
                    </td>
                    {tools.map((tool) => (
                      <td
                        key={tool}
                        className={[
                          "px-4 py-3 text-center",
                          tool === SITE_CONFIG.name ? "bg-emerald-500/5" : "",
                        ].join(" ")}
                      >
                        <ComparisonCellIcon value={cellValue(row, tool)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="border-t border-[var(--dd-border-strong)] px-5 py-4 text-xs text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3 w-3 text-emerald-500" /> Yes
            </span>
            <span className="mx-3 inline-flex items-center gap-1.5">
              <Minus className="h-3 w-3 text-amber-400" /> Partial
            </span>
            <span className="inline-flex items-center gap-1.5">
              <X className="h-3 w-3 text-[var(--tx-sec)]" /> No
            </span>
          </div>
        </div>

        <div className="mt-8 text-center">
          <ViewAllLink />
        </div>
      </div>
    </section>
  );
}
