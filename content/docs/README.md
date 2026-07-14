# Versioned docs content

- `current/`: active/default docs, currently served as `v1.6`
- `v1.5/`: stable `1.5` docs initialized from the published `v1.5.2` tag
- `v1.4/`: stable `1.4` docs
- `v1.3/`: previous stable `1.3` docs

Each directory contains `meta.json` files that define navigation titles and page ordering.

## Versioned-doc correction policy

Versioned docs preserve the behavior and release identity of their source version, but they are not a byte-for-byte museum. Known-bad commands, unsafe credential examples, and incorrect behavior claims are corrected when the affected version remains publicly served. Corrections must stay compatible with that version's implementation and be mirrored into `current/` when the same defect remains there.

The v1.5 tree differs from the published v1.5.2 source only for its generated changelog and reviewed documentation errata: sanitized ACR, GAR, Telegram, Gotify, and Rocket.Chat credential examples; corrected API/action/authentication/SBOM/self-update behavior; fixed IMGSET regex and Compose Argon2 escaping; corrected deprecation, security, verification, quickstart, and illustrative timestamp copy. These are documentation-only corrections and do not change the archived product behavior.

## Sync pipeline

`apps/web/scripts/sync-docs.mjs` (run via `npm run sync:docs` and on `postinstall`) copies
these source directories into the gitignored `apps/web/content/docs/`:

- `content/docs/current` → `apps/web/content/docs/v1.6`
- `content/docs/v1.5`    → `apps/web/content/docs/v1.5`
- `content/docs/v1.4`    → `apps/web/content/docs/v1.4`
- `content/docs/v1.3`    → `apps/web/content/docs/v1.3`

The script also generates the active version's changelog page from the root `CHANGELOG.md`
(or `$DD_CHANGELOG_PATH` if set). A missing changelog file is non-fatal: the script logs a
warning and skips generation. Generated docs links are scoped to each version slug so archived
versions do not jump back into current docs. The build output is staged in a `docs.tmp`
directory and renamed into place atomically so a mid-run crash cannot leave an empty docs tree.
