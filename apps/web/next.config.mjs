import { createMDX } from "fumadocs-mdx/next";

import { escapeRegExp, versions } from "./scripts/docs-versions.mjs";

const withMDX = createMDX();

// Derived from the single source of truth in scripts/docs-versions.mjs.
// First entry = current/default version; all slugs feed the prefix regex.
const docsCurrentVersion = versions[0].slug;
const docsRedirectExclusions = [
  "assets(?:/|$)",
  ...versions.map((v) => escapeRegExp(v.slug) + "(?:/|$)"),
].join("|");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  // Do NOT re-enable experimental.sri here. Turbopack DID gain SRI support in
  // Next 16.2, so "the bundler supports it now" is not a reason to turn it back
  // on. The hash is computed at build time on the raw chunk, but Vercel's edge
  // re-encodes the bytes (brotli/gzip), so the integrity attribute never matches
  // what the browser receives and every _next/static script gets blocked.
  // Nothing hydrates: homepage reveal sections stay invisible, docs nav goes
  // dead. Open upstream bug: vercel/next.js#91633. Removed in #236, re-added by
  // mistake in v1.5.1-rc.1 (#454). Only safe to re-enable once #91633 ships a
  // fix. The CSP in vercel.json is the real script hardening here.
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
      source: `/docs/:path((?!${docsRedirectExclusions}).*)`,
      destination: `/docs/${docsCurrentVersion}/:path`,
      permanent: false,
    },
  ],
};

export default withMDX(nextConfig);
