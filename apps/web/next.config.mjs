import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();
const docsCurrentVersion = "v1.5";
const docsVersionPrefixes = "v1\\.5(?:/|$)|v1\\.4(?:/|$)|v1\\.3(?:/|$)";

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.shields.io",
      },
    ],
  },
  redirects: async () => [
    {
      source: "/docs",
      destination: `/docs/${docsCurrentVersion}`,
      permanent: false,
    },
    {
      source: `/docs/:path((?!${docsVersionPrefixes}).*)`,
      destination: `/docs/${docsCurrentVersion}/:path`,
      permanent: false,
    },
  ],
};

export default withMDX(nextConfig);
