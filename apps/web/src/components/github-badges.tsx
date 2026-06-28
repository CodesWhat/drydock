import type { LucideIcon } from "lucide-react";
import { Download, GitFork, Heart, Star } from "lucide-react";
import type { ReactNode } from "react";
import { DOCKER_HUB_URL, GITHUB_URL, REPO_SLUG } from "@/lib/site-config";

// Awesome Lists brand mark (Simple Icons) — the sunglasses, in their pink.
function AwesomeIcon({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M24 11.438l-6.154-5.645-.865.944 5.128 4.7H1.895l5.128-4.705-.865-.943-6.154 5.649H0v3.72c0 1.683 1.62 3.053 3.61 3.053h3.795c1.99 0 3.61-1.37 3.61-3.051v-2.446h1.97v2.446c0 1.68 1.62 3.051 3.61 3.051h3.794c1.99 0 3.61-1.37 3.61-3.051v-3.721z" />
    </svg>
  );
}

// OSS trust strip in two treatments:
//   1. Quality/security — shields.io pills (machine-generated = verifiable trust)
//   2. Social/distribution — native design-system stat tiles (design-owned)
// Stat values are a periodically-refreshed snapshot, not live-fetched.

type Badge = { href: string; src: string; alt: string };

// ── Treatment 1: quality/security (shields.io, the visual lead) ──────────────
const quality: Badge[] = [
  {
    href: `${GITHUB_URL}/blob/main/LICENSE`,
    src: "https://img.shields.io/badge/license-AGPL--3.0-C9A227",
    alt: "License AGPL-3.0",
  },
  {
    href: `${GITHUB_URL}/actions/workflows/ci-verify.yml`,
    src: `${GITHUB_URL}/actions/workflows/ci-verify.yml/badge.svg?branch=main`,
    alt: "CI",
  },
  {
    href: `https://securityscorecards.dev/viewer/?uri=github.com/${REPO_SLUG}`,
    src: `https://img.shields.io/ossf-scorecard/github.com/${REPO_SLUG}?label=openssf+scorecard&style=flat`,
    alt: "OpenSSF Scorecard",
  },
  {
    href: "https://qlty.sh/gh/CodesWhat/projects/drydock",
    src: "https://qlty.sh/gh/CodesWhat/projects/drydock/test_coverage.svg",
    alt: "Test coverage",
  },
  {
    href: `https://dashboard.stryker-mutator.io/reports/github.com/${REPO_SLUG}/main`,
    src: `https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2F${REPO_SLUG.replace("/", "%2F")}%2Fmain`,
    alt: "Mutation score",
  },
];

// ── Treatment 2: social/distribution (native tiles) ──────────────────────────
type Stat = {
  href: string;
  icon?: LucideIcon;
  node?: ReactNode;
  iconClass?: string;
  value?: string;
  label: string;
};

const stats: Stat[] = [
  {
    href: `${GITHUB_URL}/stargazers`,
    icon: Star,
    iconClass: "fill-amber-400 text-amber-400",
    value: "203",
    label: "stars",
  },
  {
    href: DOCKER_HUB_URL,
    icon: Download,
    iconClass: "text-sky-500",
    value: "128K",
    label: "downloads",
  },
  {
    href: `${GITHUB_URL}/forks`,
    icon: GitFork,
    iconClass: "text-violet-500",
    value: "10",
    label: "forks",
  },
  {
    href: "https://github.com/veggiemonk/awesome-docker",
    node: <AwesomeIcon className="h-4 w-4 shrink-0 text-[#fc60a8]" />,
    label: "Featured in awesome-docker",
  },
];

function QualityRow() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {quality.map((b) => (
        <a key={b.alt} href={b.href} target="_blank" rel="noopener noreferrer">
          <img src={b.src} alt={b.alt} loading="lazy" className="h-5 w-auto" />
        </a>
      ))}
    </div>
  );
}

function StatTiles() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-white/50 px-4 py-2.5 backdrop-blur-sm transition-colors hover:border-neutral-300 hover:bg-white/80 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-neutral-700 dark:hover:bg-neutral-900/80"
          >
            {s.node ? (
              s.node
            ) : Icon ? (
              <Icon className={`h-4 w-4 shrink-0 ${s.iconClass ?? ""}`} />
            ) : null}
            <span className="flex items-baseline gap-1.5">
              {s.value ? (
                <span className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {s.value}
                </span>
              ) : null}
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                {s.label}
              </span>
            </span>
          </a>
        );
      })}

      {/* Lone funding CTA — accent treatment so it reads as an action, not a stat */}
      <a
        href="https://github.com/sponsors/CodesWhat"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-2.5 backdrop-blur-sm transition-colors hover:border-rose-300 hover:bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30 dark:hover:border-rose-800 dark:hover:bg-rose-950/50"
      >
        <Heart className="h-4 w-4 shrink-0 text-rose-500" />
        <span className="text-sm font-medium text-rose-700 dark:text-rose-300">Sponsor</span>
      </a>
    </div>
  );
}

export function GitHubBadges() {
  return (
    <div className="flex flex-col items-center gap-4">
      <QualityRow />
      <StatTiles />
    </div>
  );
}
