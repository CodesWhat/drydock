# Drydock Documentation

The published documentation is available at **[getdrydock.com/docs](https://getdrydock.com/docs)**.

## Source of truth

Documentation content is versioned under `/content/docs`:

- `/content/docs/current` is the active release line and is published under the newest version slug
- `/content/docs/vX.Y` directories preserve earlier lines, with reviewed version-compatible corrections under the [content policy](../content/docs/README.md)

The version list itself lives in `apps/web/scripts/docs-versions.mjs`. Its first entry maps the `current` source directory to the active public slug, and every other entry maps a snapshot source directory to its slug. Update that file, not this one, when a line ships or retires.

The site/docs app lives in `/apps/web` and uses `npm run sync:docs` to copy each entry from `docs-versions.mjs` into `apps/web/content/docs/<slug>`. The synced copy is gitignored.

## Where the live lines stand right now

| Line | Status | Maps to |
|---|---|---|
| v1.8 | next, unreleased development on `dev/v1.8` | `current` contains its drafts. Release preparation must archive the production-line v1.7 docs and map `current` to v1.8; it must not archive the mixed development tree as v1.7. |
| v1.7 | current (`docs-versions.mjs`'s first entry, `slug: "v1.7"`) | `content/docs/current` |
| v1.6 | maintenance (previous line) | `content/docs/v1.6`, a frozen snapshot |
| v1.5 and earlier | archived, no longer maintained | `content/docs/v1.5`, `v1.4`, `v1.3`, frozen snapshots |

`current` holds the docs for the line being written, so this development branch includes v1.8 behavior even though `docs-versions.mjs` still maps it to the v1.7 slug. That is not a claim of v1.7 availability. Do not deploy this checkout as a website-only production correction. Read `apps/web/scripts/docs-versions.mjs` for the exact mapping; this table is a snapshot of it, not a replacement.
