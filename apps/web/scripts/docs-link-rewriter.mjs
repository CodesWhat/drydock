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

const CHANGELOG_FILE_RE = /(^|\/)changelog\/index\.mdx?$/;

// Applies both rewriters to a single synced doc file, keyed off its path
// relative to the version's docs root. The root CHANGELOG.md source (and the
// currently-generated changelog) use relative `./DEPRECATIONS.md` links,
// which is also what got committed verbatim into the frozen
// content/docs/v1.x/changelog/index.mdx snapshots when each version was
// archived -- rewriteDocsLinksForVersion only rewrites absolute `/docs/...`
// targets, so those relative links never got fixed. Scoping this to
// changelog files (rather than running rewriteChangelogLinksForVersion over
// every doc file) keeps the archived, deliberately-historical snapshots from
// being touched anywhere a `DEPRECATIONS.md` mention isn't actually a
// changelog link.
export function rewriteDocsFileForVersion(relativePath, content, versionSlug) {
  const withChangelogLinksFixed = CHANGELOG_FILE_RE.test(relativePath)
    ? rewriteChangelogLinksForVersion(content, versionSlug)
    : content;
  return rewriteDocsLinksForVersion(withChangelogLinksFixed, versionSlug);
}
