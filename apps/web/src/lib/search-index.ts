import { basename, extname } from "node:path";
import type { AdvancedIndex } from "fumadocs-core/search/server";
import type { Page } from "fumadocs-core/source";
import type { DocsPageData } from "./source";

/**
 * Builds a search index entry for a docs page, tagged with its docs version.
 *
 * A page's first URL segment is its version slug (content/docs/v1.7/... syncs
 * to /docs/v1.7/..., so `page.slugs` is `["v1.7", ...rest]` — see
 * scripts/docs-versions.mjs, the source of truth for the version list).
 * Tagging the index with that segment is what lets `/api/search?tag=v1.7`
 * filter to one version's pages.
 *
 * Mirrors fumadocs-core's own default `buildIndex` (title-from-filename
 * fallback, `structuredData` already resolved by our non-lazy MDX collection)
 * plus the `tag`; only `import type` deps otherwise, so this can be unit
 * tested without pulling in the generated `.source` collection graph. See
 * scripts/search-index.test.mjs.
 */
export function buildDocsSearchIndex(page: Page<string | undefined, DocsPageData>): AdvancedIndex {
  return {
    id: page.url,
    url: page.url,
    title: page.data.title ?? basename(page.path, extname(page.path)),
    description: page.data.description,
    structuredData: page.data.structuredData,
    tag: page.slugs[0],
  };
}
