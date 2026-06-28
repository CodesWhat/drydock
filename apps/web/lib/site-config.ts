/**
 * Single source of truth for site identity, branding, and external URLs.
 *
 * This is the per-site config consumed by the shared CodesWhat shell chrome
 * (header, footer, background, layout, metadata). To re-skin the shell for
 * another site, edit only this file — every component and route reads from here.
 */

const githubOwner = "CodesWhat";
const githubRepo = "drydock";

export type AuroraPalette = "ember" | "ocean" | "violet" | "forest" | "mono";

export const SITE_CONFIG = {
  /** Brand name shown in the header, footer, and metadata. */
  name: "Drydock",
  /** Short product tagline used in page titles and OG metadata. */
  tagline: "Container Update Monitoring",
  /** Default meta / OpenGraph / Twitter description. */
  description:
    "Open source container update monitoring built in TypeScript. Auto-discover containers, detect image updates, and trigger notifications across 20+ services.",
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
  /** Logo asset in /public. */
  logo: "/whale-logo.png",
  /** Whether the logo inverts in dark mode (adds `dark:invert`). */
  logoInvertOnDark: true,
  /** Default OpenGraph / Twitter share image in /public. */
  ogImage: "/og-image.png",
  /** OpenGraph locale. */
  locale: "en_US",
  /** Live demo URL (overridable per-environment via NEXT_PUBLIC_DEMO_URL). */
  demoUrl: "https://demo.getdrydock.com",
  /** Docker Hub image, "owner/name". */
  dockerImage: "codeswhat/drydock",
  /** License link shown in the footer. */
  licenseUrl: "https://www.gnu.org/licenses/agpl-3.0.html",
  /** Aurora background palette token (see globals.css `[data-bg]`). */
  aurora: "ocean" as AuroraPalette,
  /** Prefix for localStorage keys (keeps multi-site deploys from colliding). */
  storagePrefix: "dd",
} as const;

export type SiteConfig = typeof SITE_CONFIG;

/** "owner/repo" slug — used in shields.io / OpenSSF scorecard badge URLs. */
export const REPO_SLUG = `${SITE_CONFIG.githubOwner}/${SITE_CONFIG.githubRepo}`;
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
