import Image from "next/image";
import { CtaButtons } from "@/components/cta-buttons";
import { GitHubBadges } from "@/components/github-badges";
import { Badge } from "@/components/ui/badge";
import { SITE_CONFIG } from "@/lib/site-config";

const stats = [
  { value: "23", label: "registries" },
  { value: "20+", label: "triggers" },
  { value: "100%", label: "coverage" },
  { value: "AGPL-3.0", label: "license" },
] as const;

// Locked: hero variant A — centered, oversized type, whale mascot + badges below.
export function HeroVariants() {
  return (
    <section className="relative px-4 py-20">
      {/* Background glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 -translate-y-1/4 rounded-full bg-[var(--au-glow)] blur-3xl opacity-60" />
      </div>

      <div className="mx-auto max-w-6xl px-4">
        {/* Center stack */}
        <div className="flex flex-col items-center gap-6 text-center">
          <Badge variant="secondary" className="font-mono text-xs">
            v1.5.0 &middot; Open Source
          </Badge>

          <h1 className="max-w-3xl text-6xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 sm:text-7xl lg:text-8xl">
            Container Update
            <br />
            <span className="text-neutral-400 dark:text-neutral-500">Monitoring</span>
          </h1>

          <p className="max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
            Self-hosted and open source. Drydock watches every container you&apos;re running, flags
            what&apos;s outdated or exposed, and lets you roll out fixes on your terms.
          </p>

          <CtaButtons align="center" />

          {/* Stat strip */}
          <div className="flex flex-wrap items-center justify-center gap-0 divide-x divide-neutral-200 dark:divide-neutral-700">
            {stats.map((stat) => (
              <div key={stat.label} className="px-4 first:pl-0">
                <span className="font-mono text-xs font-semibold uppercase tracking-widest text-neutral-900 dark:text-neutral-100">
                  {stat.value}
                </span>
                <span className="ml-1 font-mono text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Mascot moment — the whale, with a soft glow */}
        <div className="relative mt-12 flex justify-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center"
          >
            <div className="h-72 w-72 rounded-full bg-[var(--au-glow)] opacity-50 blur-3xl" />
          </div>
          <Image
            src={SITE_CONFIG.logo}
            alt=""
            width={280}
            height={190}
            className={`animate-float drop-shadow-2xl${SITE_CONFIG.logoInvertOnDark ? " dark:invert" : ""}`}
            priority
          />
        </div>

        {/* GitHub / distribution / quality badges */}
        <div className="mt-12">
          <GitHubBadges />
        </div>
      </div>
    </section>
  );
}
