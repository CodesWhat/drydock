import type { Page } from "fumadocs-core/source";
import { loader } from "fumadocs-core/source";
import { docs } from "../../.source/server";

export const source = loader(docs.toFumadocsSource(), {
  baseUrl: "/docs",
});

/** Frontmatter + body type for a docs page, derived from the generated collection. */
export type DocsPageData = (typeof docs.docs)[number];

/** Typed getPage — avoids `as any` while preserving fumadocs' slug typing. */
export function getDocsPage(slugs?: string[]) {
  // Page<Type, Data>: the first generic is the slug type, not the data type.
  // Fumadocs' loader widens .data back to base PageData without the cast.
  return source.getPage(slugs) as Page<string | undefined, DocsPageData> | undefined;
}
