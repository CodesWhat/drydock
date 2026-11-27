/**
 * Single source of truth for site identity, branding, and external URLs.
 *
 * This is the per-site config consumed by the shared CodesWhat shell chrome
 * (header, footer, background, layout, metadata). To re-skin the shell for
 * another site, edit only this file — every component and route reads from here.
 */

import { versions } from "../../scripts/docs-versions.mjs";

const githubOwner = "CodesWhat";
const githubRepo = "drydock";

export type AuroraPalette = "ember" | "ocean" | "violet" | "forest" | "mono";

export const SITE_CONFIG = {
  /** Brand name shown in the header, footer, and metadata. */
  name: "Drydock",
  /** Current release version shown in the hero badge. */
  version: "1.9.0-rc.1",
  /** Latest stable release, shown next to the RC in the hero. */
  stableVersion: "1.7.1",
  /** Short product tagline used in page titles and OG metadata. */
  tagline: "Container Update Monitoring",
  /** Default page title: carries the search-intent phrase ("Docker", "self-hosted"). */
  title: "Drydock: Self-Hosted Docker Container Update Monitor",
  /** Default meta / OpenGraph / Twitter / JSON-LD description. Counts match the README (23 registries, 21 triggers). */
  description:
    "Open source Docker container update manager. Checks 23 registries for newer image versions, then notifies you or applies updates through 21 triggers.",
  /** Production domain (no protocol, no trailing slash). */
  domain: "getdrydock.com",
  /** GitHub owner/org. */
  githubOwner,
  /** GitHub repository name. */
  githubRepo,
  /** Twitter/X handle for the twitter:creator card. */
  twitterCreator: "@codeswhat",
  /** Twitter/X profile URL (used in JSON-LD sameAs). */
  twitterUrl: "https://x.com/codeswhat",
  /** Discord community invite. */
  discordUrl: "https://discord.gg/mWHCPJRzSx",
  /** Logo asset in /public. */
  logo: "/whale.webp",
  /** Whether the logo inverts in dark mode (adds `dark:invert`). */
  logoInvertOnDark: false,
  /** Default OpenGraph / Twitter share image in /public. */
  ogImage: "/og-image.png",
  /** OpenGraph locale. */
  locale: "en_US",
  /** Live demo URL (overridable per-environment via NEXT_PUBLIC_DEMO_URL). */
  demoUrl: "https://demo.getdrydock.com",
  /** Docker Hub image, "owner/name". */
  dockerImage: "codeswhat/drydock",
  /** License link shown in the footer. */
  licenseUrl: "https://opensource.org/licenses/MIT",
  /** Aurora background palette token (see globals.css `[data-bg]`). */
  aurora: "ocean" as AuroraPalette,
  /** Prefix for localStorage keys (keeps multi-site deploys from colliding). */
  storagePrefix: "dd",
} as const;

export type SiteConfig = typeof SITE_CONFIG;

/** "owner/repo" slug — used in shields.io / OpenSSF scorecard badge URLs. */
export const REPO_SLUG = `${SITE_CONFIG.githubOwner}/${SITE_CONFIG.githubRepo}`;
/**
 * Root of the current docs version (versions[0] in scripts/docs-versions.mjs).
 * Internal links point here directly so nav clicks skip the /docs redirect.
 * The GA rollover changes the versions list, not this constant.
 */
export const DOCS_VERSION: string = versions[0].slug;
export const DOCS_ROOT = `/docs/${DOCS_VERSION}`;
/**
 * Docs line of the latest stable release, derived from SITE_CONFIG.stableVersion
 * ("1.7.1" -> "v1.7"). Lines listed before it in the versions config have no GA
 * release yet, so their pages carry a pre-release notice pointing back here.
 */
export const STABLE_DOCS_VERSION: string = (() => {
  const [major, minor] = SITE_CONFIG.stableVersion.split(".");
  return `v${major}.${minor}`;
})();
export const STABLE_DOCS_ROOT = `/docs/${STABLE_DOCS_VERSION}`;

/** True when the docs line is newer than the latest stable line. */
export function isPreReleaseDocsLine(slug: string): boolean {
  const index = versions.findIndex((v) => v.slug === slug);
  const stableIndex = versions.findIndex((v) => v.slug === STABLE_DOCS_VERSION);
  return index !== -1 && stableIndex !== -1 && index < stableIndex;
}
/** Canonical GitHub repository URL. */
export const GITHUB_URL = `https://github.com/${REPO_SLUG}`;
/** GitHub releases page. */
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;
/** Docker Hub repository URL. */
export const DOCKER_HUB_URL = `https://hub.docker.com/r/${SITE_CONFIG.dockerImage}`;

/**
 * Site base URL. Prefers NEXT_PUBLIC_SITE_URL (Vercel/preview deploys),
 * falls back to the configured production domain. `||` (not `??`) so a
 * set-but-empty env var falls back too.
 */
export const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || `https://${SITE_CONFIG.domain}`;
/** Live demo URL, overridable per-environment. */
export const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || SITE_CONFIG.demoUrl;
