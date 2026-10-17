# apps/docs

This directory is reserved for a dedicated docs deployment.

Current state:

- Documentation is served from `/apps/web` at the `/docs` route.
- Canonical docs content lives in `/content/docs/current` and versioned snapshots under `/content/docs/`. See [the content guide](../../content/docs/README.md) for the active mapping and development-version caveat; `apps/web/scripts/docs-versions.mjs` owns the serving slugs.

Keeping docs in `apps/web` currently avoids duplicate implementations while preserving one source of truth.
