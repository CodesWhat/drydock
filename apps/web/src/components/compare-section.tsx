import { ArrowRight, Check, Minus, X } from "lucide-react";
import Link from "next/link";
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
  { label: "Distributed agents", drydock: "yes", watchtower: "no", diun: "no", portainer: "no" },
];

function FeatureIcon({ value }: { value: FeatureValue }) {
  if (value === "yes") {
    return <Check className="mx-auto h-4 w-4 text-emerald-500" aria-label="Yes" />;
  }
  if (value === "partial") {
    return <Minus className="mx-auto h-4 w-4 text-amber-400" aria-label="Partial" />;
  }
  return <X className="mx-auto h-4 w-4 text-neutral-400 dark:text-neutral-600" aria-label="No" />;
}

function ViewAllLink() {
  return (
    <Link
      href="/compare"
      className="group inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white/50 px-6 py-3 font-medium text-neutral-900 backdrop-blur-sm transition-all hover:border-neutral-300 hover:bg-white/80 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-100 dark:hover:border-neutral-700 dark:hover:bg-neutral-900/80"
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
    <section className="border-t border-border/60 py-20">
      <div className="mx-auto max-w-4xl px-4">
        <SectionHeading
          eyebrow={`Why ${SITE_CONFIG.name}`}
          title="How we compare"
          subtitle="A quick look at what we support that Portainer, Diun, and others don't."
          align="right"
        />

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="px-5 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                    Feature
                  </th>
                  {tools.map((tool) => (
                    <th
                      key={tool}
                      className={[
                        "px-4 py-3 text-center font-semibold",
                        tool === SITE_CONFIG.name
                          ? "bg-neutral-900/5 text-neutral-900 dark:bg-neutral-100/5 dark:text-neutral-100"
                          : "text-neutral-500 dark:text-neutral-400",
                      ].join(" ")}
                    >
                      {tool}
                      {tool === SITE_CONFIG.name && (
                        <span className="ml-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                      {tool === "Watchtower" && (
                        <span className="mt-0.5 block text-[10px] font-normal uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
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
                      "border-b border-neutral-100 last:border-0 dark:border-neutral-800/60",
                      i % 2 === 1 ? "bg-neutral-50/50 dark:bg-neutral-800/20" : "",
                    ].join(" ")}
                  >
                    <td className="px-5 py-3 text-neutral-700 dark:text-neutral-300">
                      {row.label}
                    </td>
                    {tools.map((tool) => (
                      <td
                        key={tool}
                        className={[
                          "px-4 py-3 text-center",
                          tool === SITE_CONFIG.name ? "bg-neutral-900/5 dark:bg-neutral-100/5" : "",
                        ].join(" ")}
                      >
                        <FeatureIcon value={cellValue(row, tool)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-neutral-200 px-5 py-4 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3 w-3 text-emerald-500" /> Yes
            </span>
            <span className="mx-3 inline-flex items-center gap-1.5">
              <Minus className="h-3 w-3 text-amber-400" /> Partial
            </span>
            <span className="inline-flex items-center gap-1.5">
              <X className="h-3 w-3 text-neutral-400" /> No
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
