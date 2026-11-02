/**
 * JSON-LD builders for every page type. Pure data, no React, so scripts/structured-data.test.mjs
 * can build each page's graph and validate it. Every graph is self-contained: a `{ "@id" }`
 * reference always resolves to a node in the same graph, because @id references do not
 * resolve across separate pages.
 */
import { faqItems } from "../app/data/faq.ts";
import { type Advisory, getAdvisory } from "./advisories.ts";
import {
  BASE_URL,
  DOCKER_HUB_URL,
  DOCS_ROOT,
  GITHUB_RELEASES_URL,
  GITHUB_URL,
  SITE_CONFIG,
} from "./site-config.ts";
import { features } from "./site-content.ts";

type Node = Record<string, unknown>;

export const CODESWHAT_URL = "https://codeswhat.com";
export const ORGANIZATION_ID = `${CODESWHAT_URL}/#organization`;
export const WEBSITE_ID = `${BASE_URL}/#website`;
export const SOFTWARE_ID = `${BASE_URL}/#software`;

const ref = (id: string) => ({ "@id": id });

export function graph(...nodes: Array<Node | undefined>): Node {
  return {
    "@context": "https://schema.org",
    "@graph": nodes.filter((node): node is Node => node !== undefined),
  };
}

export function organizationNode(): Node {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "CodesWhat",
    url: CODESWHAT_URL,
    // public/codeswhat-logo.png is 830x835.
    logo: {
      "@type": "ImageObject",
      url: `${BASE_URL}/codeswhat-logo.png`,
      width: 830,
      height: 835,
    },
    sameAs: ["https://github.com/CodesWhat", SITE_CONFIG.twitterUrl],
  };
}

export function websiteNode(): Node {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_CONFIG.name,
    alternateName: `${SITE_CONFIG.name} ${SITE_CONFIG.tagline}`,
    url: BASE_URL,
    inLanguage: "en",
    publisher: ref(ORGANIZATION_ID),
  };
}

export function softwareApplicationNode(): Node {
  return {
    "@type": "SoftwareApplication",
    "@id": SOFTWARE_ID,
    name: SITE_CONFIG.name,
    url: BASE_URL,
    description: SITE_CONFIG.description,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: SITE_CONFIG.tagline,
    operatingSystem: "Docker",
    // The stable release, not the RC the hero offers for testing.
    softwareVersion: SITE_CONFIG.stableVersion,
    programmingLanguage: "TypeScript",
    license: "https://opensource.org/licenses/MIT",
    isAccessibleForFree: true,
    image: `${BASE_URL}${SITE_CONFIG.ogImage}`,
    featureList: features.map((feature) => feature.title),
    downloadUrl: GITHUB_RELEASES_URL,
    installUrl: GITHUB_RELEASES_URL,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    sameAs: [GITHUB_URL, SITE_CONFIG.twitterUrl, DOCKER_HUB_URL],
    author: ref(ORGANIZATION_ID),
    publisher: ref(ORGANIZATION_ID),
    softwareHelp: {
      "@type": "WebPage",
      url: `${BASE_URL}${DOCS_ROOT}`,
    },
  };
}

export type Crumb = { name: string; url: string };

export function breadcrumbNode(pageUrl: string, crumbs: Crumb[]): Node {
  return {
    "@type": "BreadcrumbList",
    "@id": `${pageUrl}#breadcrumb`,
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

const sharedNodes = () => [organizationNode(), websiteNode(), softwareApplicationNode()];

export function buildHomeJsonLd(): Node {
  const pageId = `${BASE_URL}/#webpage`;
  return graph(
    ...sharedNodes(),
    {
      "@type": "WebPage",
      "@id": pageId,
      url: BASE_URL,
      name: SITE_CONFIG.title,
      description: SITE_CONFIG.description,
      inLanguage: "en",
      isPartOf: ref(WEBSITE_ID),
      about: ref(SOFTWARE_ID),
    },
    {
      "@type": "FAQPage",
      "@id": `${BASE_URL}/#faq`,
      isPartOf: ref(pageId),
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  );
}

export function buildCompareIndexJsonLd(
  tools: Array<{ name: string; slug: string }>,
  { name, description }: { name: string; description: string },
): Node {
  const url = `${BASE_URL}/compare`;
  return graph(
    ...sharedNodes(),
    {
      "@type": "CollectionPage",
      "@id": `${url}#webpage`,
      name,
      description,
      url,
      inLanguage: "en",
      isPartOf: ref(WEBSITE_ID),
      about: ref(SOFTWARE_ID),
      breadcrumb: ref(`${url}#breadcrumb`),
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: tools.length,
        itemListElement: tools.map((tool, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${url}/${tool.slug}`,
          name: `${tool.name} vs Drydock`,
        })),
      },
    },
    breadcrumbNode(url, [
      { name: "Home", url: BASE_URL },
      { name: "Compare", url },
    ]),
  );
}

export function buildComparisonJsonLd({
  slug,
  name,
  description,
  competitorName,
}: {
  slug: string;
  name: string;
  /** Same string the page's meta description uses. */
  description: string;
  competitorName: string;
}): Node {
  const url = `${BASE_URL}/compare/${slug}`;
  const competitorId = `${url}#competitor`;
  return graph(
    ...sharedNodes(),
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      name,
      description,
      url,
      inLanguage: "en",
      isPartOf: ref(WEBSITE_ID),
      about: [ref(SOFTWARE_ID), ref(competitorId)],
      breadcrumb: ref(`${url}#breadcrumb`),
    },
    // Name only: the competitor's url, version and license are not asserted here.
    { "@type": "SoftwareApplication", "@id": competitorId, name: competitorName },
    breadcrumbNode(url, [
      { name: "Home", url: BASE_URL },
      { name: "Compare", url: `${BASE_URL}/compare` },
      { name: competitorName, url },
    ]),
  );
}

export function buildDocsJsonLd({
  url,
  title,
  description,
  version,
  crumbs,
}: {
  url: string;
  title: string;
  description?: string;
  /** Docs version slug, e.g. "v1.8". */
  version: string;
  crumbs: Crumb[];
}): Node {
  return graph(
    organizationNode(),
    {
      "@type": "TechArticle",
      "@id": `${url}#article`,
      headline: title,
      ...(description ? { description } : {}),
      url,
      inLanguage: "en",
      version: version.replace(/^v/, ""),
      mainEntityOfPage: url,
      author: ref(ORGANIZATION_ID),
      publisher: ref(ORGANIZATION_ID),
      breadcrumb: ref(`${url}#breadcrumb`),
    },
    breadcrumbNode(url, crumbs),
  );
}

export function buildAdvisoryJsonLd(
  slug: string,
  extra: { keywords: string; about: Node[]; isBasedOn: string; abstract: string },
): Node {
  const advisory: Advisory = getAdvisory(slug);
  const url = `${BASE_URL}/security/${advisory.slug}`;
  return graph(
    organizationNode(),
    {
      "@type": "TechArticle",
      "@id": `${url}#article`,
      headline: `${advisory.title} — Drydock Security Advisory`,
      description: advisory.summary,
      abstract: extra.abstract,
      datePublished: advisory.datePublished,
      dateModified: advisory.dateModified,
      image: `${BASE_URL}${SITE_CONFIG.ogImage}`,
      inLanguage: "en",
      url,
      mainEntityOfPage: url,
      isBasedOn: extra.isBasedOn,
      author: ref(ORGANIZATION_ID),
      publisher: ref(ORGANIZATION_ID),
      keywords: extra.keywords,
      about: extra.about,
      breadcrumb: ref(`${url}#breadcrumb`),
    },
    breadcrumbNode(url, [
      { name: "Home", url: BASE_URL },
      { name: "Security", url: `${BASE_URL}/security` },
      { name: advisory.title, url },
    ]),
  );
}

export function buildSecurityIndexJsonLd(advisories: Advisory[]): Node {
  const url = `${BASE_URL}/security`;
  return graph(
    organizationNode(),
    {
      "@type": "CollectionPage",
      "@id": `${url}#webpage`,
      name: "Drydock Security Advisories",
      url,
      inLanguage: "en",
      publisher: ref(ORGANIZATION_ID),
      breadcrumb: ref(`${url}#breadcrumb`),
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: advisories.length,
        itemListElement: advisories.map((advisory, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${url}/${advisory.slug}`,
          name: advisory.title,
        })),
      },
    },
    breadcrumbNode(url, [
      { name: "Home", url: BASE_URL },
      { name: "Security", url },
    ]),
  );
}
