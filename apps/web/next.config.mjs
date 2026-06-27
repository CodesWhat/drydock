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
  // Do NOT re-enable experimental.sri here. Next emits integrity hashes that
  // don't match the bytes Vercel actually serves (Turbopack chunks plus
  // post-build compression), so the browser blocks every script and nothing
  // hydrates: homepage reveal sections stay invisible and the docs nav goes
  // dead. It was removed in #236 for this exact reason and re-added by mistake
  // in v1.5.1-rc.1 (#454). The CSP in vercel.json is the real script hardening.
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
