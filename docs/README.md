# Drydock Documentation

The published documentation is available at **[getdrydock.com/docs](https://getdrydock.com/docs)**.

## Source of truth

Documentation content is versioned under `/content/docs`:

- `/content/docs/current` is the active release line and is published under the newest version slug
- `/content/docs/vX.Y` directories are frozen snapshots of earlier lines

The version list itself lives in `apps/web/scripts/docs-versions.mjs`. Its first entry maps the `current` source directory to the active public slug, and every other entry maps a snapshot source directory to its slug. Update that file, not this one, when a line ships or retires.

The site/docs app lives in `/apps/web` and uses `npm run sync:docs` to copy each entry from `docs-versions.mjs` into `apps/web/content/docs/<slug>`. The synced copy is gitignored.

## Where the live lines stand right now

| Line | Status | Maps to |
|---|---|---|
| v1.8 | next, in development on `dev/v1.8` | still `current` — there is no `content/docs/v1.8` yet. It's cut from `current` at v1.8 GA, the same way `content/docs/v1.6` was cut from `current` at v1.6 GA. |
| v1.7 | current (`docs-versions.mjs`'s first entry, `slug: "v1.7"`) | `content/docs/current` |
| v1.6 | maintenance (previous line) | `content/docs/v1.6`, a frozen snapshot |
| v1.5 and earlier | archived, no longer maintained | `content/docs/v1.5`, `v1.4`, `v1.3`, frozen snapshots |

`current` always holds the docs for whichever line is actively being written, which is why v1.8 work already lands there even before `docs-versions.mjs` is bumped at the release cut. Reread `apps/web/scripts/docs-versions.mjs` for the exact mapping — this table is a snapshot of it, not a replacement.
