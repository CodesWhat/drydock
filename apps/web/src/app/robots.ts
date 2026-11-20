import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/site-config";
import { versions } from "../../scripts/docs-versions.mjs";

// Search and user-initiated AI crawlers are named so the policy is explicit and a later
// edit to the catch-all group cannot quietly narrow it. No training crawler is blocked.
const AI_SEARCH_AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Claude-SearchBot",
  "Claude-User",
];

// The named groups can fetch /_next/ so a rendering crawler gets the page's CSS and JS.
// Superseded docs versions (everything but the first entry) stay reachable for readers
// but are closed to crawlers, so bots don't spend function time on five old doc trees.
const ARCHIVED_DOCS = versions.slice(1).flatMap((v) => [`/docs/${v.slug}/`, `/docs/${v.slug}$`]);

const DISALLOW = ["/api/", "/_next/", ...ARCHIVED_DOCS];
const AI_DISALLOW = ["/api/", ...ARCHIVED_DOCS];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      ...AI_SEARCH_AGENTS.map((userAgent) => ({ userAgent, allow: "/", disallow: AI_DISALLOW })),
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
