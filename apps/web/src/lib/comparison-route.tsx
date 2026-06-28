import { Check, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ComparisonPage, type ComparisonRow, type Highlight } from "@/components/comparison-page";
import { BASE_URL, SITE_CONFIG } from "@/lib/site-config";

type ComparisonMetadataConfig = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  openGraphDescription?: string;
  twitterDescription?: string;
};

type ComparisonJsonLdConfig = {
  slug: string;
  name: string;
  description: string;
  competitorName: string;
};

export type ComparisonRouteConfig = {
  slug: string;
  metadataTitle: string;
  metadataDescription: string;
  metadataKeywords: string[];
  openGraphDescription?: string;
  twitterDescription?: string;
  competitorName: string;
  heroTitle: string;
  heroDescription: ReactNode;
  comparisonData: ComparisonRow[];
  highlights: Highlight[];
  migrationTitle: string;
  migrationDescription: string;
  jsonLdName: string;
  jsonLdDescription: string;
  competitorBadge?: {
    icon: LucideIcon;
    label: string;
    className: string;
  };
  selfBadge?: {
    icon: LucideIcon;
    label: string;
    className: string;
  };
};

const competitorBadgeClassName =
  "bg-blue-100 px-3 py-1 text-sm text-blue-700 dark:bg-blue-900/50 dark:text-blue-400";
const selfBadgeClassName =
  "bg-emerald-100 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400";

export function buildComparisonMetadata({
  slug,
  title,
  description,
  keywords,
  openGraphDescription = description,
  twitterDescription = description,
}: ComparisonMetadataConfig): Metadata {
  return {
    // absolute: comparison titles already carry the brand ("X vs Drydock …");
    // opt out of the root "%s | Drydock" template.
    title: { absolute: title },
    description,
    keywords,
    openGraph: {
      title,
      description: openGraphDescription,
      url: `${BASE_URL}/compare/${slug}`,
      siteName: SITE_CONFIG.name,
      locale: SITE_CONFIG.locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: twitterDescription,
      creator: SITE_CONFIG.twitterCreator,
    },
    alternates: {
      canonical: `${BASE_URL}/compare/${slug}`,
    },
  };
}

export function buildComparisonJsonLd({
  slug,
  name,
  description,
  competitorName,
}: ComparisonJsonLdConfig): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name,
        description,
        url: `${BASE_URL}/compare/${slug}`,
        mainEntity: {
          "@type": "SoftwareApplication",
          name: SITE_CONFIG.name,
          url: BASE_URL,
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Docker",
          license: "https://opensource.org/licenses/AGPL-3.0",
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: BASE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Compare",
            item: `${BASE_URL}/compare`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: competitorName,
            item: `${BASE_URL}/compare/${slug}`,
          },
        ],
      },
    ],
  };
}

export function createComparisonRoute(config: ComparisonRouteConfig) {
  const competitorBadge = config.competitorBadge ?? {
    icon: Check,
    label: `${config.competitorName} — Active`,
    className: competitorBadgeClassName,
  };
  const selfBadge = config.selfBadge ?? {
    icon: Check,
    label: `${SITE_CONFIG.name} — Active`,
    className: selfBadgeClassName,
  };

  const metadata = buildComparisonMetadata({
    slug: config.slug,
    title: config.metadataTitle,
    description: config.metadataDescription,
    keywords: config.metadataKeywords,
    openGraphDescription: config.openGraphDescription,
    twitterDescription: config.twitterDescription,
  });

  function RoutePage() {
    return (
      <ComparisonPage
        competitorName={config.competitorName}
        heroTitle={config.heroTitle}
        heroDescription={config.heroDescription}
        competitorBadge={competitorBadge}
        selfBadge={selfBadge}
        comparisonData={config.comparisonData}
        highlights={config.highlights}
        migrationTitle={config.migrationTitle}
        migrationDescription={config.migrationDescription}
        jsonLd={buildComparisonJsonLd({
          slug: config.slug,
          name: config.jsonLdName,
          description: config.jsonLdDescription,
          competitorName: config.competitorName,
        })}
      />
    );
  }

  return { metadata, RoutePage };
}

export function row(
  feature: string,
  competitor: string,
  self: string,
  verdict: ComparisonRow["verdict"],
): ComparisonRow {
  return { feature, competitor, self, verdict };
}

export function highlight(icon: LucideIcon, title: string, description: string): Highlight {
  return { icon, title, description };
}

function parsePipeTableRows(table: string): string[][] {
  return table
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split("|").map((part) => part.trim()));
}

export function rowsFromPipeTable(table: string): ComparisonRow[] {
  return parsePipeTableRows(table).map((columns, index) => {
    if (columns.length !== 4) {
      throw new Error(`Invalid comparison row at line ${index + 1}: expected 4 columns`);
    }

    const [feature, competitor, self, verdict] = columns;
    if (verdict !== "self" && verdict !== "competitor" && verdict !== "tie") {
      throw new Error(`Invalid verdict at line ${index + 1}: ${verdict}`);
    }

    return row(feature, competitor, self, verdict);
  });
}

export function highlightsFromPipeTable(
  table: string,
  iconMap: Record<string, LucideIcon>,
): Highlight[] {
  return parsePipeTableRows(table).map((columns, index) => {
    if (columns.length !== 3) {
      throw new Error(`Invalid highlight row at line ${index + 1}: expected 3 columns`);
    }

    const [iconKey, title, description] = columns;
    const icon = iconMap[iconKey];
    if (!icon) {
      throw new Error(`Unknown highlight icon key at line ${index + 1}: ${iconKey}`);
    }

    return highlight(icon, title, description);
  });
}
