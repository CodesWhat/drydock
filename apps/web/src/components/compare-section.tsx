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
  diun: FeatureValue;
  watchtower: FeatureValue;
}

// Cells are copied from the README feature comparison matrix (update managers).
const featureRows: FeatureRow[] = [
  { label: "Web UI / dashboard", drydock: "yes", wud: "yes", diun: "no", watchtower: "no" },
  { label: "Semver-aware updates", drydock: "yes", wud: "yes", diun: "partial", watchtower: "no" },
  {
    label: "Image backup & rollback",
    drydock: "yes",
    wud: "partial",
    diun: "no",
    watchtower: "no",
  },
  { label: "Vulnerability scanning", drydock: "yes", wud: "no", diun: "no", watchtower: "no" },
  {
    label: "Distributed agents",
    drydock: "yes",
    wud: "partial",
    diun: "no",
    watchtower: "partial",
  },
  // Where others win. Drydock has no RBAC yet (README matrix).
  { label: "RBAC / multi-user roles", drydock: "no", wud: "yes", diun: "no", watchtower: "no" },
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

const tools = [SITE_CONFIG.name, "WUD", "Diun", "Watchtower"] as const;
type Tool = (typeof tools)[number];

function cellValue(row: FeatureRow, tool: Tool): FeatureValue {
  const map: Record<Tool, FeatureValue> = {
    [SITE_CONFIG.name]: row.drydock,
    WUD: row.wud,
    Diun: row.diun,
    Watchtower: row.watchtower,
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
          subtitle="How Drydock stacks up against WUD, Diun and Watchtower (archived December 2025). Rows come from the README matrix, including one where WUD wins."
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

        <div className="mt-6 space-y-3 text-sm text-[var(--tx-sec)]">
          <p>
            <b className="text-[var(--dd-text)]">Probably not for you yet:</b> Swarm, Kubernetes and
            Nomad watchers, RBAC and multi-user roles, and a one-shot CI mode. Swarm, Kubernetes and
            RBAC are planned for v2.0 and later. If you need any of them today, WUD is the closer
            fit.
          </p>
          <p>
            <b className="text-[var(--dd-text)]">Switching:</b> coming from WUD? Run{" "}
            <code>docker exec -it drydock node dist/index.js config migrate --dry-run</code> to
            preview the rewrite of your <code>WUD_*</code> variables and <code>wud.*</code> labels
            to <code>DD_*</code> and <code>dd.*</code>. Coming from Watchtower, which was archived
            in December 2025? Read the{" "}
            <Link href="/compare/watchtower" className="underline underline-offset-4">
              Watchtower comparison
            </Link>{" "}
            or the{" "}
            <Link href="/compare/wud" className="underline underline-offset-4">
              WUD comparison
            </Link>
            .
          </p>
        </div>

        <div className="mt-8 text-center">
          <ViewAllLink />
        </div>
      </div>
    </section>
  );
}
