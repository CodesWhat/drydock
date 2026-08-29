import { createFromSource } from "fumadocs-core/search/server";
import { buildDocsSearchIndex } from "@/lib/search-index";
import { source } from "@/lib/source";

// buildDocsSearchIndex tags every indexed page with its docs version, so a
// version-scoped query (?tag=<version>, sent by the client dialog wired up
// in docs-search-dialog.tsx) only matches that version's pages. Without a
// tag, every archived version's pages pool into one untagged index and any
// query returns hits from every version at once — see buildDocsSearchIndex
// for the mechanics.
export const { GET } = createFromSource(source, {
  buildIndex: buildDocsSearchIndex,
});
