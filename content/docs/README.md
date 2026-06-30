# Versioned docs content

- `current/`: active/default docs, currently served as `v1.5`
- `v1.4/`: stable `1.4` docs
- `v1.3/`: previous stable `1.3` docs

Each directory contains `meta.json` files that define navigation titles and page ordering.

## Sync pipeline

`apps/web/scripts/sync-docs.mjs` (run via `npm run sync:docs` and on `postinstall`) copies
these source directories into the gitignored `apps/web/content/docs/`:

- `content/docs/current` → `apps/web/content/docs/v1.5`
- `content/docs/v1.4`    → `apps/web/content/docs/v1.4`
- `content/docs/v1.3`    → `apps/web/content/docs/v1.3`

The script also generates the active version's changelog page from the root `CHANGELOG.md`
(or `$DD_CHANGELOG_PATH` if set). A missing changelog file is non-fatal: the script logs a
warning and skips generation. Generated docs links are scoped to each version slug so archived
versions do not jump back into current docs. The build output is staged in a `docs.tmp`
directory and renamed into place atomically so a mid-run crash cannot leave an empty docs tree.
