import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/site-config";

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
const DISALLOW = ["/api/", "/_next/"];
const AI_DISALLOW = ["/api/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      ...AI_SEARCH_AGENTS.map((userAgent) => ({ userAgent, allow: "/", disallow: AI_DISALLOW })),
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
