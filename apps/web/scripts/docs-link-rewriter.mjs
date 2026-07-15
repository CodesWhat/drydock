const VERSIONED_DOCS_TARGET_RE = /^\/docs\/v\d+(?:\.\d+)?(?:\/|#|$)/;
const DOCS_LINK_TARGET_RE =
  /(?<prefix>\]\(|href=["']|src=["'])(?<target>\/docs(?:[/#][^)"'\s]*)?)/g;

function shouldRewriteDocsTarget(target) {
  if (target === "/docs/assets" || target.startsWith("/docs/assets/")) {
    return false;
  }
  return !VERSIONED_DOCS_TARGET_RE.test(target);
}

export function rewriteDocsLinksForVersion(content, versionSlug) {
  return content.replace(DOCS_LINK_TARGET_RE, (match, prefix, target) => {
    if (!shouldRewriteDocsTarget(target)) {
      return match;
    }

    if (target === "/docs") {
      return `${prefix}/docs/${versionSlug}`;
    }

    return `${prefix}/docs/${versionSlug}${target.slice("/docs".length)}`;
  });
}

export function rewriteChangelogLinksForVersion(content, versionSlug) {
  const deprecationsTarget = `/docs/${versionSlug}/deprecations`;
  return content
    .replace(
      /\[DEPRECATIONS\.md\]\(\.\/DEPRECATIONS\.md\)/g,
      `[DEPRECATIONS.md](${deprecationsTarget})`,
    )
    .replace(/`DEPRECATIONS\.md`/g, `[deprecations](${deprecationsTarget})`);
}
