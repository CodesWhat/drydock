import { Check, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ComparisonPage, type ComparisonRow, type Highlight } from "@/components/comparison-page";

const fallbackBaseUrl = "https://drydock.codeswhat.com";

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || fallbackBaseUrl;
}

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
  drydockBadge?: {
    icon: LucideIcon;
    label: string;
    className: string;
  };
};

const competitorBadgeClassName =
  "bg-blue-100 px-3 py-1 text-sm text-blue-700 dark:bg-blue-900/50 dark:text-blue-400";
const drydockBadgeClassName =
  "bg-emerald-100 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400";

export function buildComparisonMetadata({
  slug,
  title,
  description,
  keywords,
  openGraphDescription = description,
  twitterDescription = description,
}: ComparisonMetadataConfig): Metadata {
  const baseUrl = getBaseUrl();

  return {
    title,
    description,
    keywords,
    openGraph: {
      title,
      description: openGraphDescription,
      url: `${baseUrl}/compare/${slug}`,
      siteName: "Drydock",
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: twitterDescription,
      creator: "@codeswhat",
    },
    alternates: {
      canonical: `${baseUrl}/compare/${slug}`,
    },
  };
}

export function buildComparisonJsonLd({
  slug,
  name,
  description,
}: ComparisonJsonLdConfig): Record<string, unknown> {
  const baseUrl = getBaseUrl();

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    description,
    url: `${baseUrl}/compare/${slug}`,
    mainEntity: {
      "@type": "SoftwareApplication",
      name: "Drydock",
      url: baseUrl,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Docker",
      license: "https://opensource.org/licenses/AGPL-3.0",
    },
  };
}

export function createComparisonRoute(config: ComparisonRouteConfig) {
  const competitorBadge = config.competitorBadge ?? {
    icon: Check,
    label: `${config.competitorName} — Active`,
    className: competitorBadgeClassName,
  };
  const drydockBadge = config.drydockBadge ?? {
    icon: Check,
    label: "Drydock — Active",
    className: drydockBadgeClassName,
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
        drydockBadge={drydockBadge}
        comparisonData={config.comparisonData}
        highlights={config.highlights}
        migrationTitle={config.migrationTitle}
        migrationDescription={config.migrationDescription}
        jsonLd={buildComparisonJsonLd({
          slug: config.slug,
          name: config.jsonLdName,
          description: config.jsonLdDescription,
        })}
      />
    );
  }

  return { metadata, RoutePage };
}

export function row(
  feature: string,
  competitor: string,
  drydock: string,
  verdict: ComparisonRow["verdict"],
): ComparisonRow {
  return { feature, competitor, drydock, verdict };
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

    const [feature, competitor, drydock, verdict] = columns;
    if (verdict !== "drydock" && verdict !== "competitor" && verdict !== "tie") {
      throw new Error(`Invalid verdict at line ${index + 1}: ${verdict}`);
    }

    return row(feature, competitor, drydock, verdict);
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
