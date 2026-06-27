import { ArrowUpRight, Check, Minus, X } from "lucide-react";
import Link from "next/link";

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
    name: "Drydock",
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
      maintained: "yes",
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
      rollback: "partial",
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

function CellIcon({ value }: { value: Cell }) {
  if (value === "yes") {
    return <Check className="mx-auto h-4 w-4 text-emerald-500" aria-label="Yes" />;
  }
  if (value === "partial") {
    return <Minus className="mx-auto h-4 w-4 text-amber-400" aria-label="Partial" />;
  }
  return <X className="mx-auto h-4 w-4 text-neutral-300 dark:text-neutral-600" aria-label="No" />;
}

export function CompareMatrix() {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                Tool
              </th>
              {FEATURES.map((f) => (
                <th
                  key={f.key}
                  className="whitespace-nowrap px-3 py-3 text-center text-xs font-medium text-neutral-500 dark:text-neutral-400"
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
                  "border-b border-neutral-100 last:border-0 dark:border-neutral-800/60",
                  tool.highlight ? "bg-emerald-500/5" : "",
                ].join(" ")}
              >
                <th scope="row" className="whitespace-nowrap px-4 py-3 text-left font-normal">
                  {tool.slug ? (
                    <Link
                      href={`/compare/${tool.slug}`}
                      className="group inline-flex items-center gap-1.5 font-medium text-neutral-700 transition-colors hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                    >
                      {tool.name}
                      <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-2 font-semibold text-neutral-900 dark:text-neutral-100">
                      {tool.name}
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                  )}
                </th>
                {FEATURES.map((f) => (
                  <td key={f.key} className="px-3 py-3 text-center">
                    <CellIcon value={tool.cells[f.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-500">
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-3 w-3 text-emerald-500" /> Yes
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Minus className="h-3 w-3 text-amber-400" /> Partial
        </span>
        <span className="inline-flex items-center gap-1.5">
          <X className="h-3 w-3 text-neutral-300 dark:text-neutral-600" /> No
        </span>
        <span className="text-neutral-400 dark:text-neutral-600">
          · Click a tool for the full breakdown
        </span>
      </div>
    </div>
  );
}
