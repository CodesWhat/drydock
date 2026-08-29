"use client";

import DefaultSearchDialog, {
  type DefaultSearchDialogProps,
} from "fumadocs-ui/components/dialog/search-default";
import { usePathname } from "next/navigation";
import { docsSearchTagForPathname } from "@/lib/docs-search-tag";

/**
 * Scopes the site's single search dialog (fumadocs-ui's default, mounted once
 * by RootProvider in the root layout) to whichever docs version the reader is
 * currently on.
 *
 * Without this, /api/search pools every archived docs version into one
 * index: a reader on the current docs searching a common term gets the
 * frozen v1.4 changelog as a top hit, and it only gets worse as more
 * versions get archived. Off the docs entirely (marketing pages), search
 * defaults to the current version rather than offering a version picker —
 * most searches from outside the docs are for current content, and a reader
 * who wants an archived version is already on its URL and can search from
 * there. See docs-search-tag.ts for the pathname -> version mapping and
 * search-index.ts for the server side (tagging the index).
 */
export function DocsSearchDialog(props: DefaultSearchDialogProps) {
  const pathname = usePathname();

  return <DefaultSearchDialog {...props} defaultTag={docsSearchTagForPathname(pathname)} />;
}
