import type { LucideIcon } from "lucide-react";
import { AlertTriangle, BookOpen, Check, Clock, Github, Minus, Terminal, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type ComparisonRow = {
  feature: string;
  competitor: string;
  drydock: string;
  verdict: "drydock" | "competitor" | "tie";
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
  drydockBadge: CompetitorBadge;
  comparisonData: ComparisonRow[];
  highlights: Highlight[];
  migrationTitle: string;
  migrationDescription: string;
  jsonLd: Record<string, unknown>;
};

function VerdictIcon({ verdict }: { verdict: ComparisonRow["verdict"] }) {
  if (verdict === "drydock" || verdict === "competitor") {
    return <Check className="h-4 w-4 text-emerald-500" />;
  }
  return <Minus className="h-4 w-4 text-neutral-400" />;
}

export function ComparisonPage({
  competitorName,
  heroTitle,
  heroDescription,
  competitorBadge,
  drydockBadge,
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
      <main className="relative min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-950 dark:to-neutral-900">
        {/* Background Pattern */}
        <div className="bg-grid-neutral-200/50 dark:bg-grid-neutral-800/50 fixed inset-0" />

        <div className="relative z-10">
          {/* Hero Section */}
          <section className="relative px-4 pt-20 pb-16">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_70%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_70%)]" />

            <div className="relative z-10 mx-auto max-w-4xl text-center">
              <Link
                href="/"
                className="mb-8 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <Image
                  src="/whale-logo.png"
                  alt="Drydock"
                  width={20}
                  height={20}
                  className="dark:invert"
                />
                drydock.codeswhat.com
              </Link>

              <h1 className="mt-6 mb-6 text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 sm:text-5xl lg:text-6xl">
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
                <Badge className={drydockBadge.className}>
                  <drydockBadge.icon className="mr-1.5 h-3.5 w-3.5" />
                  {drydockBadge.label}
                </Badge>
              </div>
            </div>
          </section>

          {/* Comparison Table */}
          <section className="px-4 py-16">
            <div className="mx-auto max-w-5xl">
              <div className="relative mb-12 text-center">
                <div className="pointer-events-none absolute inset-y-[-1.5rem] left-1/2 w-[30rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
                <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
                  Feature Comparison
                </h2>
                <p className="relative mx-auto max-w-2xl text-neutral-600 dark:text-neutral-400">
                  A side-by-side look at what each tool offers.
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
                            ) : row.verdict === "drydock" ? (
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
                            {row.verdict === "drydock" ? (
                              <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                            ) : row.verdict === "competitor" ? (
                              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                            ) : (
                              <VerdictIcon verdict="tie" />
                            )}
                            {row.drydock}
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
              <div className="relative mb-12 text-center">
                <div className="pointer-events-none absolute inset-y-[-1.5rem] left-1/2 w-[30rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
                <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
                  Key Differentiators
                </h2>
                <p className="relative mx-auto max-w-2xl text-neutral-600 dark:text-neutral-400">
                  Where Drydock goes beyond what {competitorName} offers.
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
                      <Card className="border-neutral-200 bg-neutral-950 text-left dark:border-neutral-800">
                        <CardContent className="pt-4 pb-4">
                          <div className="mb-2 flex items-center gap-2 text-neutral-500">
                            <Terminal className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium uppercase tracking-wider">
                              Quick start
                            </span>
                          </div>
                          <pre className="overflow-x-auto text-sm">
                            <code className="text-neutral-300">
                              <span className="text-neutral-500">$</span>{" "}
                              <span className="text-[#C4FF00]">docker run</span> -d \{"\n"}
                              {"  "}--name drydock \{"\n"}
                              {"  "}-v /var/run/docker.sock:/var/run/docker.sock \{"\n"}
                              {"  "}-p 3000:3000 \{"\n"}
                              {"  "}codeswhat/drydock
                            </code>
                          </pre>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* CTA */}
          <section className="px-4 py-16">
            <div className="mx-auto max-w-3xl text-center">
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-[-1.5rem] left-1/2 w-[30rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
                <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
                  Ready to try Drydock?
                </h2>
                <p className="relative mb-8 text-neutral-600 dark:text-neutral-400">
                  Open source, MIT licensed, and actively maintained.
                </p>
              </div>

              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button size="lg" asChild>
                  <a
                    href="https://github.com/CodesWhat/drydock"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github className="h-4 w-4" />
                    View on GitHub
                  </a>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link href="/docs">
                    <BookOpen className="h-4 w-4" />
                    Documentation
                  </Link>
                </Button>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="px-4 py-8">
            <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Image
                  src="/codeswhat-logo.png"
                  alt="CodesWhat"
                  width={20}
                  height={20}
                  className="dark:invert"
                />
                <span>&copy; {new Date().getFullYear()} CodesWhat. MIT License.</span>
              </div>
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com/CodesWhat/drydock"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full p-2 text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  aria-label="GitHub"
                >
                  <Github className="h-5 w-5" />
                </a>
                <Link
                  href="/docs"
                  className="rounded-full p-2 text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  aria-label="Documentation"
                >
                  <BookOpen className="h-5 w-5" />
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}
