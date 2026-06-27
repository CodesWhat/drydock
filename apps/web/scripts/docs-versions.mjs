// Single source of truth for the docs version list.
// Imported by sync-docs.mjs, next.config.mjs, and version-coupling.test.mjs.
// Order matters: first entry = default/active version (current docs).
export const versions = [
  { slug: "v1.5", source: "current", title: "v1.5" },
  { slug: "v1.4", source: "v1.4", title: "v1.4" },
  { slug: "v1.3", source: "v1.3", title: "v1.3" },
];

// Escape every regex metacharacter (backslash included) so a version slug like
// "v1.5" is matched literally when interpolated into the docs redirect patterns.
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
