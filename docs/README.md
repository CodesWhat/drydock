# Drydock Documentation

The published documentation is available at **[getdrydock.com/docs](https://getdrydock.com/docs)**.

## Source of truth

Documentation content is now versioned at:

- `/content/docs/current` (`v1.5`, active release docs)
- `/content/docs/v1.4` (previous stable docs)
- `/content/docs/v1.3` (legacy docs)

The site/docs app lives in `/apps/web` and uses `npm run sync:docs` to copy:

- `current -> apps/web/content/docs/v1.5`
- `v1.4 -> apps/web/content/docs/v1.4`
- `v1.3 -> apps/web/content/docs/v1.3`
