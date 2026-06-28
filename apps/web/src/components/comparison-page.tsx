import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Check, Clock, Minus, X } from "lucide-react";
import { CtaButtons } from "@/components/cta-buttons";
import { DockerRunSnippet } from "@/components/docker-run-snippet";
import { MarketingShell } from "@/components/marketing-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SITE_CONFIG } from "@/lib/site-config";

export type ComparisonRow = {
  feature: string;
  competitor: string;
  self: string;
  verdict: "self" | "competitor" | "tie";
};

export type Highlight = {
  icon: LucideIcon;
  title: string;
  description: string;
};

type CompetitorBadge = {
  icon: LucideIcon;
  label: string;
  className: string;
};

type Props = {
  competitorName: string;
  heroTitle: string;
  heroDescription: React.ReactNode;
  competitorBadge: CompetitorBadge;
  selfBadge: CompetitorBadge;
  comparisonData: ComparisonRow[];
  highlights: Highlight[];
  migrationTitle: string;
  migrationDescription: string;
  jsonLd: Record<string, unknown>;
};

function VerdictIcon({ verdict }: { verdict: ComparisonRow["verdict"] }) {
  if (verdict === "self" || verdict === "competitor") {
    return <Check className="h-4 w-4 text-emerald-500" />;
  }
  return <Minus className="h-4 w-4 text-neutral-400" />;
}

export function ComparisonPage({
  competitorName,
  heroTitle,
  heroDescription,
  competitorBadge,
  selfBadge,
  comparisonData,
  highlights,
  migrationTitle,
  migrationDescription,
  jsonLd,
}: Props) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingShell>
        {/* Hero */}
        <section className="px-4 pt-16 pb-16">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 sm:text-5xl lg:text-6xl">
              {heroTitle}
            </h1>

            <div className="mx-auto mb-8 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
              {heroDescription}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Badge className={competitorBadge.className}>
                <competitorBadge.icon className="mr-1.5 h-3.5 w-3.5" />
                {competitorBadge.label}
              </Badge>
              <Badge className={selfBadge.className}>
                <selfBadge.icon className="mr-1.5 h-3.5 w-3.5" />
                {selfBadge.label}
              </Badge>
            </div>
          </div>
        </section>

        {/* Comparison Table */}
        <section className="px-4 py-16">
          <div className="mx-auto max-w-5xl">
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
                Feature Comparison
              </h2>
              <p className="mx-auto max-w-2xl text-neutral-600 dark:text-neutral-400">
                Here's how we compare on the features that matter most.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800">
                    <th className="px-4 py-3 text-left font-semibold text-neutral-900 sm:px-6 dark:text-neutral-100">
                      Feature
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-neutral-500 sm:px-6 dark:text-neutral-400">
                      {competitorName}
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-neutral-900 sm:px-6 dark:text-neutral-100">
                      Drydock
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.map((row, i) => (
                    <tr
                      key={row.feature}
                      className={
                        i < comparisonData.length - 1
                          ? "border-b border-neutral-100 dark:border-neutral-800/50"
                          : ""
                      }
                    >
                      <td className="px-4 py-3 font-medium text-neutral-900 sm:px-6 dark:text-neutral-100">
                        {row.feature}
                      </td>
                      <td className="px-4 py-3 text-neutral-500 sm:px-6 dark:text-neutral-400">
                        <span className="flex items-center gap-2">
                          {row.competitor === "No" || row.competitor === "None" ? (
                            <X className="h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-600" />
                          ) : row.verdict === "self" ? (
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                          ) : row.verdict === "competitor" ? (
                            <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                          ) : (
                            <VerdictIcon verdict="tie" />
                          )}
                          {row.competitor}
                        </span>
                      </td>
                      <td className="px-4 py-3 sm:px-6">
                        <span className="flex items-center gap-2 text-neutral-900 dark:text-neutral-100">
                          {row.verdict === "self" ? (
                            <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                          ) : row.verdict === "competitor" ? (
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                          ) : (
                            <VerdictIcon verdict="tie" />
                          )}
                          {row.self}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Key Differentiators */}
        <section className="px-4 py-16">
          <div className="mx-auto max-w-5xl">
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
                Key Differentiators
              </h2>
              <p className="mx-auto max-w-2xl text-neutral-600 dark:text-neutral-400">
                What we built that {competitorName} doesn't cover.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {highlights.map((item) => (
                <Card
                  key={item.title}
                  className="border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50"
                >
                  <CardContent className="pt-6">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
                        <item.icon className="h-5 w-5 text-emerald-500 dark:text-emerald-400" />
                      </div>
                      <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                        {item.title}
                      </h3>
                    </div>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Migration note */}
        <section className="px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <Card className="border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
                    <Clock className="h-5 w-5 text-amber-500 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                      {migrationTitle}
                    </h3>
                    <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
                      {migrationDescription}
                    </p>
                    <DockerRunSnippet
                      contentClassName="pt-4 pb-4"
                      iconClassName="h-3.5 w-3.5"
                      headerClassName="mb-2 flex items-center gap-2 text-neutral-500"
                      label="Quick start"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
              {`Ready to try ${SITE_CONFIG.name}?`}
            </h2>
            <p className="mb-8 text-neutral-600 dark:text-neutral-400">
              No SaaS subscription, no data sent off your host, and we ship updates fast.
            </p>

            <CtaButtons />
          </div>
        </section>
      </MarketingShell>
    </>
  );
}
