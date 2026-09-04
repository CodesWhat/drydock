# Drydock Documentation

The published documentation is available at **[getdrydock.com/docs](https://getdrydock.com/docs)**.

## Source of truth

Documentation content is versioned under `/content/docs`:

- `/content/docs/current` is the active release line and is published under the newest version slug
- `/content/docs/vX.Y` directories are frozen snapshots of earlier lines

The version list itself lives in `apps/web/scripts/docs-versions.mjs`. Its first entry is the slug `current` publishes as, and every other entry maps a snapshot directory to its slug. Update that file, not this one, when a line ships or retires.

The site/docs app lives in `/apps/web` and uses `npm run sync:docs` to copy each entry from `docs-versions.mjs` into `apps/web/content/docs/<slug>`. The synced copy is gitignored.
