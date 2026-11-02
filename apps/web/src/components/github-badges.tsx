import { Heart } from "lucide-react";
import { fetchLiveStats, formatCount } from "@/lib/live-stats";
import { DOCKER_HUB_URL, GITHUB_URL, REPO_SLUG, SITE_CONFIG } from "@/lib/site-config";

type Badge = { href: string; src: string; alt: string };

const quality: Badge[] = [
  {
    href: `${GITHUB_URL}/blob/main/LICENSE`,
    src: "https://img.shields.io/badge/license-MIT-C9A227",
    alt: "License MIT",
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
    href: "https://www.bestpractices.dev/projects/11915",
    src: "https://www.bestpractices.dev/projects/11915/badge",
    alt: "OpenSSF Best Practices",
  },
  {
    href: "https://qlty.sh/gh/CodesWhat/projects/drydock",
    src: "https://qlty.sh/gh/CodesWhat/projects/drydock/maintainability.svg",
    alt: "Maintainability",
  },
  {
    href: `https://dashboard.stryker-mutator.io/reports/github.com/${REPO_SLUG}/main`,
    src: `https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2F${encodeURIComponent(REPO_SLUG)}%2Fmain`,
    alt: "Mutation score",
  },
  {
    href: `https://codecov.io/gh/${REPO_SLUG}`,
    src: `https://codecov.io/gh/${REPO_SLUG}/graph/badge.svg`,
    alt: "Coverage",
  },
  {
    href: "https://github.com/veggiemonk/awesome-docker#container-management",
    src: "https://awesome.re/mentioned-badge.svg",
    alt: "Mentioned in Awesome Docker",
  },
];

export async function GitHubBadges() {
  // GITHUB_STATS_AUTH is optional and server-only (no NEXT_PUBLIC_ prefix).
  const live = await fetchLiveStats(
    { repoSlug: REPO_SLUG, dockerImage: SITE_CONFIG.dockerImage },
    { auth: process.env.GITHUB_STATS_AUTH || undefined },
  );
  const liveStats = [
    { value: live.stars, label: "stars", href: `${GITHUB_URL}/stargazers` },
    { value: live.downloads, label: "downloads", href: DOCKER_HUB_URL },
    { value: live.forks, label: "forks", href: `${GITHUB_URL}/forks` },
    { value: live.openIssues, label: "open issues", href: `${GITHUB_URL}/issues` },
  ].filter((stat): stat is typeof stat & { value: number } => stat.value !== undefined);

  return (
    <div className="website-proof">
      <ul className="website-proof-stats" aria-label="Product facts">
        <li>
          <b>23</b> registries
        </li>
        <li>
          <b>21</b> triggers
        </li>
        <li title="CI enforces 100% line, branch, function and statement coverage on the backend sources and UI TypeScript files. Vue components have separate aggregate floors, and vue-tsc typechecks scripts and templates without establishing runtime coverage.">
          <b>100%</b> TS coverage
        </li>
        {liveStats.map((stat) => (
          <li key={stat.label}>
            <a href={stat.href} target="_blank" rel="noopener noreferrer">
              <b>{formatCount(stat.value)}</b> {stat.label}
            </a>
          </li>
        ))}
        <li>
          <a href="https://github.com/sponsors/CodesWhat" target="_blank" rel="noopener noreferrer">
            <Heart size={14} aria-hidden="true" />
            Sponsor
          </a>
        </li>
      </ul>
      <ul className="website-proof-badges" aria-label="Project badges">
        {quality.map((badge) => (
          <li key={badge.alt}>
            <a href={badge.href} target="_blank" rel="noopener noreferrer">
              <img src={badge.src} alt={badge.alt} loading="lazy" decoding="async" height={20} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
