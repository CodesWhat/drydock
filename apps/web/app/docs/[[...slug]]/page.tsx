import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { StaticImageData } from "next/image";
import NextImage from "next/image";
import { notFound } from "next/navigation";
import type React from "react";
import { source } from "@/lib/source";

function MdxImage(props: React.ComponentProps<"img"> & { src?: string | StaticImageData }) {
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
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const data = page.data as any;
  const MDX = data.body;

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";
  const segments = params.slug ?? [];
  const breadcrumbItems = [
    { name: "Home", url: baseUrl },
    { name: "Docs", url: `${baseUrl}/docs` },
    ...segments.map((seg, i) => ({
      name:
        i === segments.length - 1
          ? data.title
          : seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " "),
      url: `${baseUrl}/docs/${segments.slice(0, i + 1).join("/")}`,
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

  const isFaqPage = params.slug?.length === 1 && params.slug[0] === "faq";

  const faqJsonLd = isFaqPage
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Core dumped on Raspberry PI",
            acceptedAnswer: {
              "@type": "Answer",
              text: 'If at startup you face a "Fatal error: unreachable code" crash, add the --security-opt seccomp=unconfined option to your docker command. Example: docker run ... --security-opt seccomp=unconfined codeswhat/drydock',
            },
          },
        ],
      }
    : null;

  return (
    <DocsPage toc={data.toc} full={data.full}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
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
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";
  const url = `${baseUrl}${page.url}`;

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
      siteName: "Drydock",
    },
    twitter: {
      title: page.data.title,
      description: page.data.description,
      card: "summary",
    },
  };
}
