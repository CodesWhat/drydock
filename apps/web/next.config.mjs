import { createMDX } from "fumadocs-mdx/next";

import { escapeRegExp, versions } from "./scripts/docs-versions.mjs";

const withMDX = createMDX();

// Derived from the single source of truth in scripts/docs-versions.mjs.
// First entry = current/default version; all slugs feed the prefix regex.
const docsCurrentVersion = versions[0].slug;
const docsVersionPrefixes = versions.map((v) => escapeRegExp(v.slug) + "(?:/|$)").join("|");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  experimental: {
    sri: {
      algorithm: "sha256",
    },
  },
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
