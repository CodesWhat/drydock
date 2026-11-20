import { createFromSource } from "fumadocs-core/search/server";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { buildDocsSearchIndex } from "@/lib/search-index";
import { source } from "@/lib/source";

// buildDocsSearchIndex tags every indexed page with its docs version, so a
// version-scoped query (?tag=<version>, sent by the client dialog wired up
// in docs-search-dialog.tsx) only matches that version's pages. Without a
// tag, every archived version's pages pool into one untagged index and any
// query returns hits from every version at once — see buildDocsSearchIndex
// for the mechanics.
const search = createFromSource(source, {
  buildIndex: buildDocsSearchIndex,
});

// Per-IP, per-instance, best effort: 30 searches per minute.
const allow = createRateLimiter(30, 60_000);

export async function GET(request: Request) {
  if (!allow(clientIp(request.headers))) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  }
  return search.GET(request);
}
