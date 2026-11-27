import { Callout } from "fumadocs-ui/components/callout";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { StaticImageData } from "next/image";
import NextImage from "next/image";
import { notFound } from "next/navigation";
import type React from "react";
import { JsonLd } from "@/components/json-ld";
import {
  BASE_URL,
  DOCS_ROOT,
  isPreReleaseDocsLine,
  SITE_CONFIG,
  STABLE_DOCS_ROOT,
  STABLE_DOCS_VERSION,
} from "@/lib/site-config";
import { getDocsPage, source } from "@/lib/source";
import { buildDocsJsonLd } from "@/lib/structured-data";

// The current docs index would otherwise be titled "Introduction | Drydock".
const DOCS_INDEX_TITLE = "Drydock Documentation | Docker Container Update Monitor";

function MdxImage(
  props: Omit<React.ComponentProps<"img">, "src"> & {
    src?: React.ComponentProps<"img">["src"] | StaticImageData;
  },
) {
  const { src, alt, style, width, height, ...rest } = props;
  // Fumadocs MDX may transform image src into a static import object
  if (typeof src === "object" && src !== null && "src" in src) {
    return (
      <NextImage src={src} alt={alt ?? ""} style={{ maxWidth: "100%", height: "auto", ...style }} />
    );
  }
  // External URLs or local string paths — use native img
  return <img {...rest} src={src} style={style} alt={alt ?? ""} />;
}

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = getDocsPage(params.slug);
  if (!page) notFound();

  const data = page.data;
  const MDX = data.body;

  // Crumbs come from pages that exist (names are the titles readers see), so every
  // item URL resolves with a 200 and a folder with no index page is skipped.
  const [versionSlug, ...rest] = page.slugs;
  const crumbs = [
    { name: "Home", url: BASE_URL },
    { name: "Documentation", url: `${BASE_URL}/docs/${versionSlug}` },
  ];
  for (let i = 0; i < rest.length; i++) {
    const trail = getDocsPage([versionSlug, ...rest.slice(0, i + 1)]);
    if (trail) crumbs.push({ name: trail.data.title, url: `${BASE_URL}${trail.url}` });
  }
  const docsJsonLd = buildDocsJsonLd({
    url: `${BASE_URL}${page.url}`,
    title: data.title,
    description: data.description,
    version: versionSlug,
    crumbs,
  });

  // A line with no GA release is a release candidate. Send readers on the stable
  // line to the matching page when it exists, otherwise to that line's docs root.
  const stableCounterpart = getDocsPage([STABLE_DOCS_VERSION, ...rest]);
  const stableHref = stableCounterpart?.url ?? STABLE_DOCS_ROOT;

  return (
    <DocsPage toc={data.toc} full={data.full}>
      <JsonLd data={docsJsonLd} />
      <DocsTitle>{data.title}</DocsTitle>
      <DocsDescription>{data.description}</DocsDescription>
      {isPreReleaseDocsLine(versionSlug) && (
        <Callout type="warn" title="Pre-release docs">
          These docs cover {versionSlug}, a release candidate that isn't generally available yet.
          Running the stable release? Read the{" "}
          <a href={stableHref}>
            {stableCounterpart ? "matching page" : "docs"} for {STABLE_DOCS_VERSION}
          </a>
          .
        </Callout>
      )}
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents, img: MdxImage }} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = getDocsPage(params.slug);
  if (!page) notFound();

  const url = `${BASE_URL}${page.url}`;
  // Every version, archived ones included, canonicalises to itself so a reader on the
  // stable line lands on docs that match what they run.
  const canonical = url;
  const isCurrentIndex = page.url === DOCS_ROOT;
  const title = isCurrentIndex ? DOCS_INDEX_TITLE : page.data.title;
  const socialTitle = isCurrentIndex
    ? DOCS_INDEX_TITLE
    : `${page.data.title} | ${SITE_CONFIG.name}`;

  return {
    title: isCurrentIndex ? { absolute: title } : title,
    description: page.data.description,
    alternates: {
      canonical,
    },
    openGraph: {
      title: socialTitle,
      description: page.data.description,
      url,
      type: "article",
      siteName: SITE_CONFIG.name,
      locale: SITE_CONFIG.locale,
      images: [{ url: SITE_CONFIG.ogImage, width: 1200, height: 630, alt: socialTitle }],
    },
    twitter: {
      title: socialTitle,
      description: page.data.description,
      card: "summary_large_image",
      creator: SITE_CONFIG.twitterCreator,
      images: [SITE_CONFIG.ogImage],
    },
  };
}
