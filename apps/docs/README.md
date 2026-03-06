# apps/docs

This directory is reserved for a dedicated docs deployment.

Current state:

- Documentation is served from `/apps/web` at the `/docs` route.
- Canonical docs content lives in `/content/docs/current` (upcoming `1.4`) and `/content/docs/v1.3` (stable).

Keeping docs in `apps/web` currently avoids duplicate implementations while preserving one source of truth.
