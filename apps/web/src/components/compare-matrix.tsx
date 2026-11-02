import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { ComparisonCellChip, ComparisonCellIcon } from "@/components/comparison-cell-icon";
import { SITE_CONFIG } from "@/lib/site-config";

// Full comparison matrix for /compare. Each competitor row links to its
// dedicated deep-dive page. Cell values are derived from the per-tool
// comparison data in lib/comparison-route-data/.

type Cell = "yes" | "partial" | "no";

const FEATURES = [
  { key: "webui", label: "Web UI" },
  { key: "notifications", label: "Notify" },
  { key: "autoupdate", label: "Auto-update" },
  { key: "rollback", label: "Rollback" },
  { key: "vulnscan", label: "Vuln scan" },
  { key: "multiregistry", label: "Registries" },
  { key: "agents", label: "Agents" },
  { key: "maintained", label: "Maintained" },
  { key: "opensource", label: "Open source" },
] as const;

type FeatureKey = (typeof FEATURES)[number]["key"];

type Tool = {
  name: string;
  slug: string | null;
  highlight?: boolean;
  cells: Record<FeatureKey, Cell>;
};

const TOOLS: Tool[] = [
  {
    name: SITE_CONFIG.name,
    slug: null,
    highlight: true,
    cells: {
      webui: "yes",
      notifications: "yes",
      autoupdate: "yes",
      rollback: "yes",
      vulnscan: "yes",
      multiregistry: "yes",
      agents: "yes",
      maintained: "yes",
      opensource: "yes",
    },
  },
  {
    name: "Arcane",
    slug: "arcane",
    cells: {
      webui: "yes",
      notifications: "yes",
      autoupdate: "yes",
      rollback: "no",
      vulnscan: "yes",
      multiregistry: "partial",
      agents: "yes",
      maintained: "yes",
      opensource: "yes",
    },
  },
  {
    name: "Portainer",
    slug: "portainer",
    cells: {
      webui: "yes",
      notifications: "partial",
      autoupdate: "yes",
      rollback: "partial",
      vulnscan: "no",
      multiregistry: "partial",
      agents: "partial",
      maintained: "yes",
      opensource: "partial",
    },
  },
  {
    name: "Komodo",
    slug: "komodo",
    cells: {
      webui: "yes",
      notifications: "partial",
      autoupdate: "yes",
      rollback: "no",
      vulnscan: "no",
      multiregistry: "partial",
      agents: "yes",
      maintained: "yes",
      opensource: "yes",
    },
  },
  {
    name: "Diun",
    slug: "diun",
    cells: {
      webui: "no",
      notifications: "yes",
      autoupdate: "no",
      rollback: "no",
      vulnscan: "no",
      multiregistry: "partial",
      agents: "no",
      maintained: "yes",
      opensource: "yes",
    },
  },
  {
    name: "Dockge",
    slug: "dockge",
    cells: {
      webui: "yes",
      notifications: "no",
      autoupdate: "no",
      rollback: "no",
      vulnscan: "no",
      multiregistry: "no",
      agents: "partial",
      maintained: "partial",
      opensource: "yes",
    },
  },
  {
    name: "Dockhand",
    slug: "dockhand",
    cells: {
      webui: "yes",
      notifications: "yes",
      autoupdate: "yes",
      rollback: "no",
      vulnscan: "yes",
      multiregistry: "partial",
      agents: "yes",
      maintained: "yes",
      opensource: "partial",
    },
  },
  {
    name: "Dozzle",
    slug: "dozzle",
    cells: {
      webui: "yes",
      notifications: "partial",
      autoupdate: "no",
      rollback: "no",
      vulnscan: "no",
      multiregistry: "no",
      agents: "partial",
      maintained: "yes",
      opensource: "yes",
    },
  },
  {
    name: "WUD",
    slug: "wud",
    cells: {
      webui: "yes",
      notifications: "yes",
      autoupdate: "yes",
      rollback: "no",
      vulnscan: "no",
      multiregistry: "yes",
      agents: "partial",
      maintained: "yes",
      opensource: "yes",
    },
  },
  {
    name: "Watchtower",
    slug: "watchtower",
    cells: {
      webui: "no",
      notifications: "yes",
      autoupdate: "yes",
      rollback: "no",
      vulnscan: "no",
      multiregistry: "partial",
      agents: "partial",
      maintained: "no",
      opensource: "yes",
    },
  },
  {
    name: "Ouroboros",
    slug: "ouroboros",
    cells: {
      webui: "no",
      notifications: "yes",
      autoupdate: "yes",
      rollback: "no",
      vulnscan: "no",
      multiregistry: "no",
      agents: "no",
      maintained: "no",
      opensource: "yes",
    },
  },
];

const SCROLL_CN = "website-matrix-scroll relative overflow-x-auto";

export function CompareMatrix() {
  return (
    <div className="overflow-hidden rounded-[4px] border border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)]">
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The labelled overflow region needs keyboard focus for horizontal scrolling. */}
      <section className={SCROLL_CN} aria-label="Feature comparison" tabIndex={0}>
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-[var(--dd-border-strong)]">
              <th className="website-matrix-sticky px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                Tool
              </th>
              {FEATURES.map((f) => (
                <th
                  key={f.key}
                  className="whitespace-nowrap px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--tx-sec)] dark:text-[var(--tx-sec)]"
                >
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TOOLS.map((tool) => (
              <tr
                key={tool.name}
                className={[
                  "border-b border-[var(--dd-border-strong)] last:border-0 border-[var(--dd-border-strong)]",
                  tool.highlight ? "website-matrix-row--highlight" : "",
                ].join(" ")}
              >
                <th
                  scope="row"
                  className="website-matrix-sticky whitespace-nowrap px-4 py-3 text-left font-normal"
                >
                  {tool.slug ? (
                    <Link
                      href={`/compare/${tool.slug}`}
                      className="group inline-flex items-center gap-1.5 font-medium text-[var(--dd-text)] transition-colors hover:text-[var(--dd-text)] dark:text-[var(--tx-sec)] dark:hover:text-[var(--tx-sec)]"
                    >
                      {tool.name}
                      <span className="sr-only"> vs Drydock</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-[var(--tx-sec)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </Link>
                  ) : (
                    <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                      {tool.name}
                    </span>
                  )}
                </th>
                {FEATURES.map((f) => (
                  <td key={f.key} className="px-3 py-3 text-center">
                    <ComparisonCellIcon value={tool.cells[f.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--dd-border-strong)] px-4 py-3 text-xs text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
        <span className="inline-flex items-center gap-1.5">
          <ComparisonCellChip value="yes" /> Yes
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ComparisonCellChip value="partial" /> Partial
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ComparisonCellChip value="no" /> No
        </span>
        <span className="text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
          · Click a tool for the full breakdown
        </span>
      </div>
    </div>
  );
}
