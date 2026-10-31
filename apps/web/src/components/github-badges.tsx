import { GITHUB_URL, REPO_SLUG } from "@/lib/site-config";

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

export function GitHubBadges() {
  return (
    <div className="website-proof">
      <ul className="website-proof-stats" aria-label="Product facts">
        <li>
          <b>23</b> registries
        </li>
        <li>
          <b>21</b> triggers
        </li>
        <li>
          <b>100%</b> TS coverage
        </li>
        <li>
          <b>MIT</b> license
        </li>
        <li>
          <a href="https://github.com/sponsors/CodesWhat" target="_blank" rel="noopener noreferrer">
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
