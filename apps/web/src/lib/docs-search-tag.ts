import { versions } from "../../scripts/docs-versions.mjs";

const versionSlugs = new Set(versions.map((v) => v.slug));

/** Default/active docs version slug — first entry in the source of truth. */
export const currentDocsVersionSlug: string = versions[0].slug;

/**
 * Derives which docs version the search dialog should scope results to for a
 * given pathname. A docs page tags to its own version segment
 * (`/docs/v1.5/...` -> `"v1.5"`); everywhere else — including an unrecognized
 * or missing version segment — falls back to the current version rather than
 * mixing versions or leaving the query unscoped. See docs-search-dialog.tsx
 * for why non-docs pages default to current instead of a version picker.
 */
export function docsSearchTagForPathname(pathname: string): string {
  const segments = pathname.split("/");
  const versionSegment = segments[1] === "docs" ? segments[2] : undefined;
  return versionSegment && versionSlugs.has(versionSegment)
    ? versionSegment
    : currentDocsVersionSlug;
}
