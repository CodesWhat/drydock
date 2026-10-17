# Drydock Documentation

The published documentation is available at **[getdrydock.com/docs](https://getdrydock.com/docs)**.

## Source of truth

Documentation content is versioned under `/content/docs`:

- `/content/docs/current` is the active release line and is published under the newest version slug
- `/content/docs/vX.Y` directories preserve earlier lines, with reviewed version-compatible corrections under the [content policy](../content/docs/README.md)

The version list itself lives in `apps/web/scripts/docs-versions.mjs`. Its first entry maps the `current` source directory to the active public slug, and every other entry maps a snapshot source directory to its slug. Update that file, not this one, when a line ships or retires.

The site/docs app lives in `/apps/web` and uses `npm run sync:docs` to copy each entry from `docs-versions.mjs` into `apps/web/content/docs/<slug>`. The synced copy is gitignored.

## Current release lines

| Line | Status | Maps to |
|---|---|---|
| v1.8 | v1.8.0-rc.1, opt-in testing; GA pending | `content/docs/current`, served as v1.8 |
| v1.7 | retained v1.7.0-rc.24 candidate; GA pending | `content/docs/v1.7` |
| v1.6 | latest stable is v1.6.1 | `content/docs/v1.6`, with version-compatible errata |
| v1.5 and earlier | archived | `content/docs/v1.5`, `v1.4`, `v1.3` |

The v1.7 snapshot comes from its published candidate, not the mixed v1.8 development tree. Source/provenance and exact errata contracts are documented in `content/docs/README.md`. Read `apps/web/scripts/docs-versions.mjs` for the routing source of truth. Archived documentation does not itself imply ongoing security support.
