import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ComparisonCellChip, ComparisonCellIcon } from "@/components/comparison-cell-icon";
import { SectionHeading } from "@/components/section-heading";
import { SITE_CONFIG } from "@/lib/site-config";

// Locked: Compare = the mini comparison table teaser.

type FeatureValue = "yes" | "no" | "partial";

interface FeatureRow {
  label: string;
  drydock: FeatureValue;
  wud: FeatureValue;
  arcane: FeatureValue;
  portainer: FeatureValue;
}

// Cells come from the cited competitor docs and Drydock code (compared 2026-11-27).
const featureRows: FeatureRow[] = [
  { label: "Web UI / dashboard", drydock: "yes", wud: "yes", arcane: "yes", portainer: "yes" },
  {
    label: "Semver-aware updates",
    drydock: "yes",
    wud: "yes",
    arcane: "partial",
    portainer: "no",
  },
  {
    label: "Image backup & rollback",
    drydock: "yes",
    wud: "partial",
    arcane: "no",
    portainer: "partial",
  },
  {
    label: "Vulnerability scanning",
    drydock: "yes",
    wud: "no",
    arcane: "yes",
    portainer: "partial",
  },
  {
    label: "Distributed agents",
    drydock: "yes",
    wud: "partial",
    arcane: "yes",
    portainer: "yes",
  },
  {
    label: "Pending-approval queue",
    drydock: "yes",
    wud: "no",
    arcane: "no",
    portainer: "no",
  },
  {
    label: "Maintenance windows",
    drydock: "yes",
    wud: "no",
    arcane: "no",
    portainer: "no",
  },
  { label: "Audit log", drydock: "yes", wud: "no", arcane: "yes", portainer: "partial" },
  // Drydock has three fixed roles since v1.9 (README matrix).
  {
    label: "RBAC / multi-user roles",
    drydock: "yes",
    wud: "yes",
    arcane: "yes",
    portainer: "partial",
  },
  // Where others win.
  {
    label: "Swarm / Kubernetes / Nomad",
    drydock: "no",
    wud: "partial",
    arcane: "yes",
    portainer: "yes",
  },
  { label: "One-shot CI mode", drydock: "yes", wud: "yes", arcane: "no", portainer: "no" },
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

const tools = [SITE_CONFIG.name, "WUD", "Arcane", "Portainer"] as const;
type Tool = (typeof tools)[number];

function cellValue(row: FeatureRow, tool: Tool): FeatureValue {
  const map: Record<Tool, FeatureValue> = {
    [SITE_CONFIG.name]: row.drydock,
    WUD: row.wud,
    Arcane: row.arcane,
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
          subtitle="How Drydock stacks up against WUD, Arcane and Portainer. Every cell is sourced from each project's docs or code, and the rows where others win stay in."
          align="right"
        />

        <div className="overflow-hidden rounded-[4px] border border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)]">
          <section
            className="relative overflow-x-auto"
            aria-label="Feature comparison"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: The labelled overflow region needs keyboard focus for horizontal scrolling.
            tabIndex={0}
          >
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
                          ? "website-compare-self-head"
                          : "text-[var(--tx-sec)] dark:text-[var(--tx-sec)]",
                      ].join(" ")}
                    >
                      {tool}
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
                          tool === SITE_CONFIG.name ? "website-compare-self-cell" : "",
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
              <ComparisonCellChip value="yes" /> Yes
            </span>
            <span className="mx-3 inline-flex items-center gap-1.5">
              <ComparisonCellChip value="partial" /> Partial
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ComparisonCellChip value="no" /> No
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
