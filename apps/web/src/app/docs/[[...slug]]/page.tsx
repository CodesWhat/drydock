import defaultMdxComponents from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { StaticImageData } from "next/image";
import NextImage from "next/image";
import { notFound } from "next/navigation";
import type React from "react";
import { JsonLd } from "@/components/json-ld";
import { BASE_URL, SITE_CONFIG } from "@/lib/site-config";
import { getDocsPage, source } from "@/lib/source";

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
    { name: "Docs", url: `${BASE_URL}/docs` },
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

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url,
      type: "article",
      siteName: SITE_CONFIG.name,
    },
    twitter: {
      title: page.data.title,
      description: page.data.description,
      card: "summary_large_image",
      creator: SITE_CONFIG.twitterCreator,
    },
  };
}
