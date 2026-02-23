# Fail-Open Auth Remediation Tracker

Status: completed

## Scope
- Docker watcher remote auth (already patched to fail-closed by default)
- Registry token-auth fallback paths
- HTTP trigger auth-type fallback paths
- Token auth config schema permissiveness leading to silent anonymous fallback

## Work items
- [x] W1: Patch Docker watcher remote auth fail-open paths
- [x] W2: Introduce shared fail-closed auth helper used across components
- [x] W3: Patch registry token exchange helpers/providers to fail-closed
- [x] W4: Patch HTTP trigger auth handling to fail-closed on invalid/incomplete auth
- [x] W5: Tighten token auth configuration schema to reject ambiguous partial creds
- [x] W6: Update tests for all changed behaviors
- [x] W7: Update docs/changelog entries for new fail-closed defaults
- [x] W8: Run targeted test suites and lint

## Notes
- Keep explicit insecure override only where already documented (`watcher.auth.insecure`).
- Registries/triggers now default to fail-closed with explicit errors.
