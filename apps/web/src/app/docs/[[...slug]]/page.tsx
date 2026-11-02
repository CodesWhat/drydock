import defaultMdxComponents from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { StaticImageData } from "next/image";
import NextImage from "next/image";
import { notFound } from "next/navigation";
import type React from "react";
import { JsonLd } from "@/components/json-ld";
import { BASE_URL, DOCS_ROOT, SITE_CONFIG } from "@/lib/site-config";
import { getDocsPage, source } from "@/lib/source";
import { versions } from "../../../../scripts/docs-versions.mjs";

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

  const segments = params.slug ?? [];
  const breadcrumbItems = [
    { name: "Home", url: BASE_URL },
    { name: "Docs", url: `${BASE_URL}${DOCS_ROOT}` },
    ...segments.map((seg, i) => ({
      name:
        i === segments.length - 1
          ? data.title
          : seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " "),
      url: `${BASE_URL}/docs/${segments.slice(0, i + 1).join("/")}`,
    })),
  ];
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <DocsPage toc={data.toc} full={data.full}>
      <JsonLd data={breadcrumbJsonLd} />
      <DocsTitle>{data.title}</DocsTitle>
      <DocsDescription>{data.description}</DocsDescription>
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
  const [versionSlug, ...rest] = page.slugs;
  const isArchived =
    versionSlug !== versions[0].slug && versions.some((v) => v.slug === versionSlug);
  // An archived page canonicalises to the same page in the current docs when one
  // exists. With no current counterpart it stays self-canonical and is kept out
  // of the index, so old versions don't outrank the current docs.
  const currentCounterpart = isArchived ? getDocsPage([versions[0].slug, ...rest]) : undefined;
  const canonical = currentCounterpart ? `${BASE_URL}${currentCounterpart.url}` : url;
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
    ...(isArchived && !currentCounterpart ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: socialTitle,
      description: page.data.description,
      url,
      type: "article",
      siteName: SITE_CONFIG.name,
      images: [SITE_CONFIG.ogImage],
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
