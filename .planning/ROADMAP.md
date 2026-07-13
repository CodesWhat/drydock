# Roadmap

Last updated: 2026-07-12

This file is the canonical planning roadmap.
Completed work is collapsed; detail kept only for upcoming items.

> **Single source of truth:** This file is the long-range maintainer roadmap (version lanes + feature detail). The **operational queue we actually follow** — release state, ranked do-next, and the open-issue/discussion close/wait map — lives in [`roadmap/current-tracker.md`](roadmap/current-tracker.md). Shipped historical detail goes to [`roadmap/archive.md`](roadmap/archive.md); public roadmap surfaces (`README.md` and `apps/web/app/page.tsx`) stay summaries. Current cleanup target: stop duplicating detailed roadmap text between README and the website without a shared source.

> **Competitive Context:** This revision reprioritizes several features based on a Feb 2026 competitive analysis (full matrix in `.planning/competitors.md`). Key drivers: (1) Dependency-aware ordering moved to v1.7 because Arcane and Tugtainer already ship it -- Drydock was supposed to lead here. (2) Quick wins (clickable port links, image prune) pulled into v1.7 to close visible UI gaps against Dockhand/Portainer/Arcane. (3) Basic GitOps moved from v3.0 to v2.0 because three competitors (Dockhand, Komodo, Arcane) already ship Git-based stack deployment. (4) Podman basic support added to v2.2 since Arcane and Portainer already ship it. (5) i18n framework setup added to v1.8 to enable community translations early (Dockge has 22k+ stars with 31 languages, Arcane uses Crowdin). (6) Mar 2026 update: [Docking Station](https://github.com/LooLzzz/docking-station) analyzed -- its update maturity indicator (already planned for Phase 6.5), PWA support, and keyboard shortcuts added as quick wins to v1.7. Docking Station is not a major threat (no auth, no notifications, no security, stale since Mar 2025) but confirmed maturity feature priority. Drydock's safety trifecta (rollback + hooks + maintenance windows) remains the defensible moat no competitor matches.

## 🔝 NOW — see the tracker

**The operational "what to do, and when" lives in one file: [`roadmap/current-tracker.md`](roadmap/current-tracker.md).** Release state, the ranked/gated do-next queue, and the open-discussion close/wait map are all there — follow that file. This roadmap holds the long-range strategy and version detail below; don't re-state the NOW queue here (it drifts).

---

## Version Roadmap & Near-Term Targets

> v1.5.0 RC-train history (rc.0–rc.30 feature/fix summary) moved to [`roadmap/archive.md`](roadmap/archive.md#v15x-audits) on 2026-06-29. See `CHANGELOG.md` for per-RC detail and `roadmap/current-tracker.md` for the issue/discussion map.

API versioning transition is active: `/api/v1/*` is canonical. The general `/api/*` compatibility router is removed in v1.6.0; only the directly mounted, separately documented auth and flag-gated wud-card exceptions remain on their own timelines.

Next release targets:

- **Release-channel image tags (Discussion #321):** `release-cut.yml:294-295` already publishes rolling `{{major}}.{{minor}}` (`1.5`) and `{{major}}` (`1`) tags, but `enable=` is gated on `is_prerelease == 'false'` — so the `1.5` / `1` floating tags appear automatically at v1.5.0 GA (no extra work), while the RC train currently only gets the exact `1.5.0-rc.N` tag. Gap to evaluate: a rolling RC-channel tag (e.g. `1.5.0-rc` or `1.5-rc`) so users who want to follow the candidate line can pin one tag instead of bumping `rc.N` each cut. Decide whether to add an RC-only `type=match`/static tag in the cut workflow; document the tag matrix in the install docs either way.
- **v1.5.0 cleanup backlog** (open code-quality nits — fold into the v1.6.0 perf+hardening pass):
    - **Hard-coded 1.5 s sleep in `SecurityView.vue:388`** — `scanAllContainers` does `new Promise(r => setTimeout(r, 1500))` before refreshing vulnerability data. Should subscribe to a real scan-completed signal instead. ⚠️ The dashboard's `dd:sse-scan-completed` listener was already decoupled (`useDashboardData.ts` does not listen for it); verify whether the SSE event is still emitted at all before wiring.
    - **DRY — six parallel `updateDialog*` refs in `SecurityView.vue`** (`:45-52`, `:322-327`, `:338-343`) — six scalar refs carry the `ContainerUpdateDialog` model with two duplicate assignment blocks. Collapse to one `ref<ContainerChoice | null>` or a single reactive object.
    - **`as unknown as Promise<void>` × 4 in `useContainerActions.ts:669,685,748,760`** — papering over `Promise<boolean>` vs the `useConfirmDialog.accept` `() => Promise<void>` contract. Widen `accept` to `() => Promise<unknown>` and drop the double-cast.
    - **Doubled event-buffer peak in `Docker.ts:777`** — `appendBoundedHistoryEntry` triggers prune at `> maxEntries * 2`, so `recentDockerEvents` and `aliasFilterDecisions` peak at ~2001 entries (with `RECENT_DOCKER_EVENT_LIMIT = 1000`) before splicing back to 1000. Move trigger threshold to `1.5×` or switch to a circular buffer / capped dequeue.
    - **Token-bucket map has no eviction (`app/registries/token-bucket.ts:24`)** — fine for 23 static registry hosts; pathological if `registryUrl` config errors include garbage strings or per-repo subdomains. Add a `buckets.size > 256` LRU guard.
    - **Misleading generic field name** — `BatchDispatchState<TEntry>.containers: Map<string, TEntry>` (`app/triggers/providers/trigger-batch-dispatcher.ts:3`) is used for non-container entry types too. Rename to `entries`.
    - **Three `as unknown as` casts in `Trigger.ts:1495,1943,2297`** — survived the trigger split into dedup/digest-buffer/dispatcher submodules. Widen the host class's structural typing instead of leaving the double-casts in place.
    - **`SbomState.document: unknown` in `securityViewTypes.d.ts:27`** — narrow to `JsonValue | null` or `Record<string, unknown> | null`. Low severity (only consumed by a `<pre>` block and a disabled-button check).
    - **`dd:sse-update-operation-changed` full-refresh coupling in `useDashboardData.ts:441`** — alias of `fullRefreshListener` triggers 7 concurrent API fetches per operation phase transition. Terminal `dd:container-updated` already drives the legitimate refresh; phase events should be a no-op for the dashboard or drive a scoped update.
    - **`buildRecentUpdateRows` O(2N) walk in `useDashboardComputed.ts:693`** — builds a name-count Map across `allContainers` on every computed evaluation. Memoize the Map or compute counts incrementally.
    - **Steady-state computed-chain audit on `ContainersView.vue`** — `displayContainers` → `sortedContainers` → `groupedContainers` re-runs on any container ref reassignment. Investigate whether per-container identity tracking (patch-in-place) can replace the full reassignment pattern.
    - **Backend `getContainersRaw` serialization** — `structuredClone` per container still dominates per-request cost; a tighter DTO path or partial projection for hot endpoints may help.
    - **`buildRecentStatusResponse` dual-map** (`/api/containers/recent-status`) — returns both `statusesByContainer` and `statusesByIdentity`; `normalizeRecentStatuses` does an extra pass per response. Consolidate to a single map or return only what the frontend actually indexes.
    - ~~Render-path allocation in the legacy `ContainersGroupedViews.vue` / `DataCardGrid.vue` / `DataListAccordion.vue` path~~ — **superseded and completed:** the legacy card/list components were removed, then responsive card presentation was restored on the shared DataTable path for the v1.6 mobile work. Do not revive the deleted parallel render stack.
- **★ v1.6.0 — User-Requested Features (pull-forward, ship first):** consolidated from a 2026-06-01 fan-out triage of all open Discussions. Current release dispositions and close/wait actions live in `roadmap/current-tracker.md`; the historical per-thread evidence remains under `.planning/tracker-snapshot-2026-05-06/` and `.planning/discussions/`. Ordered by demand × visible-win ÷ effort. Goal: land a visible block of community-requested wins in the next release. Items 1–4 already lived in v1.6 lanes below — promoted here so they ship as a coherent set, not buried. Items 5–6 are pulled forward from later versions; items 7–8 are documented here but **stay** in v1.7 (effort/dependency reasons noted).
    1. **#242 — Mobile-friendly views (High):** full mobile audit — card layout + icon-only badges at narrow widths + touch-target sweep across all views. Partial point-fixes already landed in v1.5.x. Medium effort, highest-visibility QoL win. (Was: v1.6 "Containers Table UX" / Design-polish.)
    2. **#209 — Separate Tag + Version columns (Med):** split the conflated version column; auto-extract software version from OCI `org.opencontainers.image.version`. (Was: v1.6 Phase 5.7.) **✅ DONE — shipped in v1.5.1-rc.4 (cut 2026-06-29, `b7cfa6eb`):** Tag/Version column split landed; `dd.inspect.tag.path` now dual-writes into the version field (non-breaking by default) with opt-in `dd.inspect.tag.version-only` routing instead of the back-compat-breaking hard reroute. See `roadmap/current-tracker.md`.
    3. **#210 — Bidirectional MQTT for Home Assistant (Med): ✅ DONE.** `command_topic` + `DD_NOTIFICATION_MQTT_{name}_HASS_COMMANDS=true` lets HA's native Install button trigger the normal update/eligibility path, with per-container rate limiting and audit outcomes. (Was: v1.6 Phase 5.8.)
    4. **#220 — Cross-device preference sync (Med): ✅ DONE locally.** Per-user `GET/PATCH /api/v1/preferences`, opt-in UI toggle, SSE propagation, and two-phase hydration are implemented and verified locally on `dev/v1.6`. (Was: v1.6 Phase 5.5.)
    5. **#198 — Health-status event notifications (Med, pulled from v2.1): implemented and verified locally.** The `container-unhealthy` notification rule (disabled by default) uses hybrid cron+event detection with restart reset, audit/counter coverage, and an audit-backed bell control. **The full auto-heal loop (monitor → delay → restart → verify, `dd.autoheal` labels) stays Phase 9.4 / v2.1.0.** No recovery/"healthy again" event or corrective action ships here.
    6. **#406 — Image stabilization debounce + ETA countdown (Low, unscheduled→v1.6): ✅ DONE.** New candidates restart the maturity soak; list/detail/dashboard surfaces show the gate-lift countdown and an explicit manual override while automatic paths continue respecting the policy.
       - **#498 follow-up — ✅ DONE locally:** watcher-level `TAG_FAMILY` actionable default plus label → imgset → watcher → built-in chains for `tag.pin.info`; stacked grey current → blue newer tags in list, card, and detail surfaces; neutral `Pinned` state; Major/Minor/Patch chip; and regression guards that keep insight non-actionable. `strict` and informational insight-on remain the safe built-ins. The reported actionable `v3.0.2 Major` result came from an explicit `dd.tag.family=loose` label; loose mode's historical cross-suffix bug is fixed and covered.
    7. **#232 — Multi-select "Update Selected" (Low — KEEP in v1.7 Phase 6.1.1):** checkbox bulk-update for an arbitrary subset. Depends on the v1.6 action-routing layer; build on solid ground in v1.7 rather than on in-flight foundations.
    8. **#219 — Dependency labels + topological update ordering (Low — KEEP in v1.7 Phase 6.1):** `dd.depends_on`, child-before-parent guard, hierarchy view. Large; `dd.hook.post` covers the common case today; competitors already ship it (the reason it sits in v1.7).
- `v1.6.0`: **Notifications, Policy & Release Intel — implemented and verified locally on `dev/v1.6`:** zero-dependency custom dashboard grid (#281), per-rule/per-trigger notification templates + preview, audit-backed notification-bell preferences, cross-device preference sync, software-version visibility, bidirectional MQTT for HA, notification/action label coexistence (#494), declarative update-policy precedence and revert UX (#320 / #307), maturity stabilization countdown, actionable Update Status panel + global `notify | manual | auto` update mode (#325), pinned-tag policy inheritance and stacked informational tag UI (#498), health-status notifications (#198), Trivy long-scan correctness + local DB warm-up (#490), trigger-taxonomy Phase 3 error-level warnings, responsive table/card list views including the #242 mobile/touch-target pass and #473 column-readability fix, Bucket C hardening, and v1.6 compatibility removals. Compose-file matching robustness (#365) shipped earlier in v1.5.1-rc.4 and is only forward-ported baseline here. **Still open before GA or explicit re-laning:** #295 cross-view link/action icon consistency, scanner runtime decoupling/Grype, SBOM off-heap storage, and the remaining #321 UX/storage slices. Do not call those shipped.
  - **✅ DONE — Declarative update policy detail** (implemented on `dev/v1.6` 2026-07-12; motivation: discussion #307; v1.4 docs aspirationally claimed `dd.updatePolicy.*` labels worked, never wired — `1093ca1b` corrected docs to UI-only; this work actually wires them):
    - **Declarative fields:** all four fields support labels + UI; maturity mode/minimum age also support the explicitly specified watcher env defaults. `dd.updatePolicy.maturityMode` (`all|mature`), `dd.updatePolicy.maturityMinAgeDays` (int ≥1), `dd.updatePolicy.skipTags` (csv), `dd.updatePolicy.skipDigests` (csv).
    - **UI-only fields:** `snoozeUntil` stays operational/ephemeral — does not belong in a deployment manifest.
    - **Three-tier precedence:** env defaults (`DD_WATCHER_<name>_MATURITY_MODE`, `DD_WATCHER_<name>_MATURITY_MIN_AGE_DAYS`) → per-container label → UI / `PATCH /api/v1/containers/:id/update-policy`. UI override persists across restarts and label changes; if a label is removed after override, override stays (no silent policy change on label delete).
    - **Origin tracking:** container record needs per-field source marker (`'env' | 'label' | 'override'`) OR two sub-objects (`labelPolicy` + `userPolicy`) merged on read. UI renders an `overridden` pill next to fields where the effective value came from the override layer; "Revert to declarative" action (per field or whole policy) clears the override.
    - **Audit / observability:** audit event on override set/clear with all three tier values; eligibility blocker `maturity-not-reached` extended to surface which tier set the active policy (e.g. "Maturity: 7 days (from label)").
    - **Acceptance:** labels parsed in Docker watcher, threaded through `addImageDetailsToContainer` → `container-init.ts` into `container.updatePolicy`; env-var defaults registered per watcher; three-tier merge in `isUpdateSuppressed` and `update-eligibility.ts`; UI override pill + revert; audit events; docs updated (`content/docs/current/configuration/watchers/index.mdx` gets new label/env rows + precedence diagram); 100% coverage on label-only / env-only / UI-only / label+UI / env+label+UI / label-removed-after-override / override-cleared.
    - **Surfaces:** `app/model/maturity-policy.ts`, `app/model/container.ts:503-526`, `app/model/update-eligibility.ts:178-204`, `app/watchers/providers/docker/label.ts`, `app/watchers/providers/docker/Docker.ts:1178-1202`, `app/watchers/providers/docker/container-init.ts:620-655`, `app/store/container.ts:720-740`.
    - **Non-goals:** file-based YAML policy config (that's the v1.8 "YAML config" track); migrating existing UI-set policies on upgrade (already in container record, become user overrides automatically).
    - **Competitor templates:** Renovate (`renovate.json` + dashboard overrides), ArgoCD (manifest source of truth + UI sync/drift banner), Terraform Cloud (workspace overrides).
- `v1.7.0`: Smart Updates & UX (dependency-aware ordering, selective bulk updates, clickable port links, image prune, static image monitoring, image maturity indicator, keyboard shortcuts, container uptime display, PWA support, debounced container discovery) + trigger taxonomy rename Phase 4 (DD_TRIGGER_* removed)
- `v1.8.0`: Fleet Management & Live Configuration (YAML config, live UI config panels, volume browser, parallel updates, SQLite store migration + ID-based container identity, i18n framework + Crowdin integration)
- `v2.0.0`: Platform Expansion (Docker Swarm, Kubernetes, basic GitOps)
- `v2.1.0`: Advanced Deployment Patterns (health check gates, canary deployments, durable self-update controller)
- `v2.2.0`: Container Operations (web terminal, file browser, image building, basic Podman support)
- `v2.3.0`: Automation & Developer Experience (API keys, passkey auth, TOTP 2FA, TypeScript actions, CLI)
- `v2.4.0`: Data Safety & Templates (scheduled backups, compose templates, secret management)
- `v3.0.0`: Advanced Platform (network topology, GPU monitoring, i18n full translations + RTL)
- `v3.1.0`: Enterprise Access & Compliance (RBAC, LDAP/AD, environment-scoped permissions, audit logging, Wolfi hardened image)
- `v3.2.0`: Drydock Socket Proxy (built-in companion proxy container, rootless/TLS/SSH security docs)

## Platform: CodesWhat Shared Docs + SaaS Shell (Immediate — cross-repo)

Goal: **one** canonical fumadocs **docs shell** + SaaS **marketing shell** that every CodesWhat app deploys from, instead of each repo drifting its own. Raised 2026-06-26 (rolester flagged sockguard's fumadocs shell while scaffolding a new docs site).

**Source of truth = drydock's DESIGN on sockguard's ARCHITECTURE.** Drydock's rebuilt `apps/web` (new header, footer, full marketing site + fumadocs docs) is the **confirmed canonical design shell for all CodesWhat apps** — verified live 2026-06-26 (localhost:3000: `/`, `/docs/v1.5`, `/compare` all serving the new design). Sockguard separately has the **cleaner structural conventions**. So: align drydock's architecture to sockguard's, keep drydock's design, then extract the result as the shared shell. Version numbers are NOT the tiebreaker — design lives in drydock; structure to copy from sockguard.

**Per-app scope:** the shared shell is published as **two independently consumable pieces** — a **docs shell** (every app) and a **marketing/SaaS shell** (apps that want drydock's site design). **rolester is the known exception: it has its own separate SaaS/marketing site, so it consumes the docs shell ONLY, not the marketing shell.** This is exactly why the two shells must be split, not bundled.

**What each repo brings (audit 2026-06-26):**

| Repo | App dir | Structure | fumadocs ui/core | mdx | next | Best thing here |
|---|---|---|---|---|---|---|
| **drydock** | `apps/web/` | root `app/`, **combined marketing + docs** | 16.6.17 | 14.2.10 | 16.2.6 (`.mjs`) | **DESIGN** — rebuilt header/footer/site, `marketing-shell` + `docs-shell` wrappers, compare system, theme/bg switch, `ui/` primitives |
| **sockguard** | `docs/` | **`src/app` + `src/lib`**, docs-only | 16.10.5 | 15.0.12 | 16.2.9 (`.ts`) | **ARCHITECTURE** — lean stock-fumadocs scaffold (`DocsLayout`/`RootProvider`), current deps, `src/` convention, `next.config.ts` |
| portwing | `docs/` | `src/`, docs-only | 16.9.3 | 15.0.11 | 16.2.9 | follower (close to sockguard) |

**Architecture moves — align drydock TO sockguard (keep drydock's design throughout):**
- Adopt the **`src/app` + `src/lib`** convention (drydock currently dumps `app/`/`components/`/`lib/` at the package root).
- Switch to **`next.config.ts`** (drydock is on `.mjs`).
- **Upgrade fumadocs 16.6→16.10 + mdx 14→15 (breaking — `source.config.ts` API changed between majors)**, next 16.2.6→16.2.9, react 19.2.4→19.2.7. drydock trails here; bumping is part of the alignment, not a reason to build from sockguard.
- Strip `components/lab/*` design-experiment variants from the canonical shell (scaffolding, not product).
- Resolve **combined-vs-split**: drydock combines marketing + docs in one app; sockguard/portwing are docs-only. Likely answer — publish `marketing-shell` + `docs-shell` as shared components so each app composes either model (combined like drydock, or docs-only like sockguard) off the same shell.

**Shared home:** `CodesWhat/components` monorepo (`~/code/codeswhat-components`, today only `@codeswhat/theme-transition`) — publish the shell as a versioned package, or stand up a `create-codeswhat-docs` template. Decide package-vs-template before extraction.

**Action items:**
1. Refactor drydock `apps/web` to the aligned architecture (`src/` layout, `next.config.ts`, fumadocs 16.10 / mdx 15) **while preserving the current design**. On a branch — drydock docs publish live on merge to `main`; verify the full build (261 pages) before merge.
2. Extract drydock's shells (the design) on the aligned structure into the shared home; parameterize per app (brand, nav, content dir).
3. Roll out: sockguard + portwing inherit **both** shells (drydock's design); rolester consumes the **docs shell only** (keeps its own SaaS/marketing site); new apps get both from day one.
4. Re-confirm versions at execution time (they drift fast — sockguard moved 16.9→16.10 in days); also check aquasim / idlescreen / codeswhat-website if they grow docs.

**Acceptance:** every CodesWhat docs + marketing site runs drydock's design on **one** shared shell + **one** pinned fumadocs baseline + **one** repo structure; a new app gets a full site by consuming the package/template with zero per-repo fumadocs wiring.

## Security Review Follow-ups (2026-06-01) — ✅ shipped

> All 23 findings resolved (11 code fixes + 2 DECIDED/by-design + 6 INFO). Detail moved to [`roadmap/archive.md`](roadmap/archive.md#v15x-audits); full report in `SECURITY-REVIEW-2026-06-01.md`.

## Quad-Audit Follow-ups (2026-06-26) — Security / Performance / Correctness / Website

Source: multi-dimensional Workflow audit (find → 3-lens adversarial verify → synthesize), 195 agents. **143 raw → 112 kept → 108 confirmed, 4 contested.** Distribution: security 23 (9 MED / 14 LOW / +4 INFO prior-fix confirmations), performance 25 (4 HIGH / 4 MED / 16 LOW / 1 INFO), correctness 32 (3 HIGH / 14 MED / 14 LOW / 1 INFO), website 28 (2 HIGH / 9 MED / 12 LOW / 5 INFO). Full JSON dump archived at the session task output (`wsdt3kggs`). Prior 2026-06-01 fixes re-confirmed live: M-1 CSRF closed; M-2 token-leg TLS fix present **but incomplete** (see bucket A).

> Buckets A & B and the Contested items shipped (v1.5.1 rc.1/rc.2); the cut history moved to [`roadmap/archive.md`](roadmap/archive.md#v15x-audits). Bucket C below remains the active v1.6.0 perf + hardening follow-up list.

### Bucket C — Roadmap follow-ups (fold into the v1.6.0 perf + hardening pass)

Not 1.5.1-blocking — scaling improvements and defense-in-depth, several are real rewrites. Don't soak these in the RC.

- **Performance (v1.6.0 perf pass):** **✅ DONE (2026-07-12):** cross-container tag-list requests are deduplicated in a per-poll cache (HIGH, `image-comparison.ts:331`); dashboard summary uses the stats projection and security overview reads the store without deep-cloning the full collection (HIGH, `api/container/crud.ts:29,44`); AppLogViewer uses the shared bounded JSON-token cache and virtualizes large collections (HIGH); system-log client rollover replaces the reactive array at its 2,000-row cap so newest-first virtualization keeps advancing. **Remaining:** Hub `getImagePublishedAt` bare axios no infra (MED); container-list full-collection load on any sort param (MED); aurora drift continuous GPU anim + eager star-history SVGs on the marketing site (MED); 16 LOW store-hygiene/micro-opts (indexes, LokiJS update patterns, per-connection timers, bundle bloat).
- **Correctness (candidate for a fuller RC, else v1.6.0):** token-fetch no retry/cache across GAR/ECR-public/Gitlab/Mau/DHI + bearer cache ignores `expires_in` (MED cluster); batch lifecycle notifications dropped on failure, no outbox retry (MED); `batch+digest`+`once` duplicate sends (MED); security-digest buffer unbounded — no TTL/cap (MED); batch-completion event lost across process restart (MED); AgentClient phantom SSE reconnect after removal (MED); edge-agent reconnect notification hardcoded `false` (MED); 2× OpenAPI `additionalProperties:false` contract violations + raw Docker error disclosure in 500s (MED); 14 LOW tag-comparison/template-engine/store-init edge cases.
- **UI reliability (v1.6.0 hardening pass, surfaced by the #466 mobile white-screen investigation 2026-07-01):** **✅ DONE (2026-07-12):** (a) `getUser()` now gives the auth bootstrap fetch an 8-second `AbortSignal.timeout`, allowing the existing logged-out fallback to render instead of hanging first paint; (b) schema-v3 preferences now migrate through each concrete intermediate version, including the v6→v7 `softwareVersion` insertion; (c) Vite preload failures and Vue Router lazy-chunk errors trigger a session-guarded one-time reload, with the guard cleared only after a successful navigation. This self-heals post-boot stale chunks; an entry-script 404 still requires correct reverse-proxy caching as documented for #466.
- **Security (defense-in-depth, hardening pass):** ECR SDK ignores operator `cafile`/`insecure` (INFO — SDK path); rate-limit key uses `socket.remoteAddress` before `req.ip` (proxy collapse, LOW); Gitlab PAT sent without `validateAuthUrlHost()` (LOW); Hub `getImagePublishedAt` no `maxRedirects` (LOW); hook allowlist basename-only match (LOW); template engine `__proto__` traversal via `IDENT_RE` (LOW); portwing WS nonce cache process-local — cross-instance replay (LOW); registry webhook single shared HMAC secret (LOW); session secret plaintext in store (LOW — already warned, encrypt-at-rest deferred to v1.8 SQLite); CI Harden-Runner audit-mode on release-cut (MED — see SC-2 decision, audit-first stance unchanged); trivy unpinned from Alpine edge/testing + `curl` retained in release image (MED/LOW — Dockerfile, curl removal already scheduled v1.7.0). OIDC bearer path `skipSubjectCheck` re-confirmed **by-design** (no id_token to bind against) — do NOT re-file.
- **Deferrals surfaced by the bucket-A adversarial audit (2026-06-26):** (a) debug-dump `url` env-token redaction is intentionally broad and also redacts non-secret diagnostic URLs like `DD_PUBLIC_URL` / OIDC issuer / registry URLs — accepted safe-default for now (documented by a test); a context-aware narrowing (only `DD_NOTIFICATION_*`/`DD_TRIGGER_*` URLs) is a possible v1.6 refinement. (b) container runtime-env redaction (`/api/containers`) closes `*_PASS` but deliberately does NOT redact `URL` (would hide `DATABASE_URL`/`API_URL` in the user-facing container view) — needs a product call before adding. (c) Quay `getTagsPage` double-encodes an already-percent-encoded cursor (`%26`→`%2526`); pre-existing, harmless with current Quay, not introduced by the pagination fix. (d) `configuration` secret-file permission `stat` runs after `readFile` (microsecond TOCTOU window with Docker bind-mounts); latent, low-value.

## UI / UX Audit Backlog

Running list of specific UX concerns to revisit during a dedicated UI/UX pass. Add items as they surface during reviews, user feedback, or during feature QA — don't try to fix them one-off mid-feature. Passes should batch these so decisions stay consistent (iconography, hover-vs-always-on affordances, accessibility, touch targets, etc.).

**Target pass:** v1.6.0 "Design polish" milestone (can split across later versions if the queue grows).

| Item | Surface / Scope | Source |
|------|-----------------|--------|
| Mobile-friendly views (broad audit) | Containers list/card/table, Dashboard widgets, drawer/sheet patterns, touch targets | Discussion #242 |
| Per-row quick-action icons on Containers List & Table views | Source project link, release notes, registry — pick iconography and standardize placement so the same affordance pattern applies everywhere (slide-in, cards, list, table). RC11 interim shipped icon-only links inside the compact cell-name badge row + actions overflow menu; proper design direction is a dedicated "Links" column (mirrors the Kind column pattern with touch-friendly 24×24 icon targets) OR promote to a first-class toolbar so the same icons reflow cleanly across all three views. Decision needed during the pass. | QA of #295 (v1.5.0) — text link works in cards/slide-in but doesn't fit single-line list/table rows |
| Surface post-update container-startup phases (health-gate, post-start liveness) in UI status — rc.35 closed the notification-side gap (success toast now waits for the replacement container via `replacementExpected`/`newContainerId`); remaining scope is a visible "Starting…" phase held through health-check readiness | Container detail / status badge, update lifecycle timeline | Issue #290 |

## Prioritized Backlog

### Tier 1 -- High-value, builds on existing strengths

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Lifecycle hooks (pre/post-update) | Medium | **Shipped** (v1.2.0 -- `dd.hook.pre`, `dd.hook.post` labels) |
| Dependency-aware update ordering | Medium | **Scheduled** -- Phase 6.1 |
| Automatic rollback on failure | Medium | **Shipped** (v1.2.0 -- `dd.rollback.auto` label, image backup + health check rollback) |
| Secure Docker access modes (proxy-first defaults + explicit unsafe opt-in) | Medium | **Shipped** (v1.4.0 -- Phase 3.9) |
| Built-in Docker socket proxy (Drydock-native, pre-configured companion container) | Medium | **Scheduled** -- Phase 15 |
| Container actions (start/stop/restart) | Small | **Shipped** (v1.2.0 -- `DD_SERVER_FEATURE_CONTAINERACTIONS`) |
| HTTP API for on-demand triggers | Small | **Shipped** (v1.2.0 -- webhook API with token auth) |

### Tier 2 -- Strategic differentiators

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Image vulnerability / CVE scanning | Medium | **Shipped** (v1.3.0 — Trivy vulnerability scanning with configurable severity blocking) |
| Update Bouncer | Medium | **Shipped** (v1.3.0 — safe-pull gate with Trivy scan + cosign verification + SBOM generation) |
| Relative-severity update gate (allow update when the new image's vuln severity counts are ≤ the running image's — "no-worse-than-current") | Medium | **Scheduled** — Phase 4.5.8 (Discussion #321) — complements the absolute `DD_SECURITY_BLOCK_SEVERITY` threshold rather than replacing it |
| SBOM generation | Small | **Shipped** (v1.3.0 — spdx-json and cyclonedx-json formats) |
| Tag regex include/exclude filters | Small | **Shipped** (v1.2.0 -- `dd.tag.include` / `dd.tag.exclude` with RE2) |
| Container grouping / stack views | Small-Medium | **Shipped** (v1.2.0 -- auto-group by Compose project) |
| Self-update controller (durable state machine + health gates + UI acknowledgment) | Large | **Scheduled** -- Phase 9.3 |
| Changelog / release notes in notifications | Medium | **Shipped** (v1.5.0 -- Phase 4.8; project links + current/available release-notes across cards/list/table/detail, Discussion #295) |
| Notification bell filtering (actionable alerts only) | Small | **Shipped** (v1.5.0 — bell whitelist + container-update dedup) |
| Notification preferences UI | Medium | **Implemented locally for v1.6** -- Phase 5.5 |
| Cross-device preference sync (server-side storage) | Medium | **Implemented locally for v1.6** -- Phase 5.5 (Discussion #220) |
| Notification templates | Medium | **Implemented locally for v1.6** -- Phase 5.2 |
| Bidirectional MQTT for Home Assistant (command_topic) | Medium | **Implemented locally for v1.6** -- Phase 5.8 |
| Security scan digest (one summary email per scan cycle) | Small-Medium | **Shipped** (v1.5.0 — SECURITYMODE=digest, bulk scan-all endpoint, UUID v7 cycleId, Discussion #300) |
| Security-page inline "Update" action on containers with updates available | Small | **Shipped** -- v1.5.0 / Phase 4.5.7 (Discussion #299) |
| Real-time log viewer | Medium | **Shipped** (v1.5.0 — WebSocket streaming with ANSI colors, JSON syntax highlighting, regex search, copy/download) |
| Container resource monitoring | Medium | **Shipped** (v1.5.0 — dashboard widget + fleet-aggregate stats) |
| Scanner runtime decoupling (docker/remote backends) | Medium | **Scheduled** -- Phase 4.5 |
| Grype scanner provider | Small | **Scheduled** -- Phase 4.5.2 |
| Image maturity / update age indicator + sort-by-age | Small-Medium | **Shipped** (v1.4.2 updateAge + maturity + sort; v1.5.0 floating-tag indicator) |
| Dashboard customization (custom grid, widget toggle, edit-mode drag-and-drop) | Medium | **Shipped** — v1.5.0 customization retained; zero-dependency custom grid replacement landed for v1.6.0 (#281) |
| Keyboard shortcuts (`/` to search, `?` for help) | Trivial | **Scheduled** -- Phase 6.7 |
| Container uptime display | Trivial | **Scheduled** -- Phase 6.8 |
| PWA support (installable web app) | Small | **Scheduled** -- Phase 6.9 |
| Smart tag suggestion for `latest` containers | Small | **Shipped** (v1.4.2 — `suggestedTag` in API response) |
| Diagnostic debug dump (redacted system state export) | Small-Medium | **Shipped** (v1.5.0 — one-click redacted JSON export from Configuration > Diagnostics) |
| Software version column (OCI metadata alongside image tag) | Small | **Shipped** -- v1.5.1-rc.4 / Phase 5.7 |
| RSS feed trigger | Small | Backlog |

### Tier 3 -- Platform expansion & operations

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Kubernetes provider | Large | **Scheduled** -- Phase 8.2 |
| Docker Swarm service provider | Medium | **Scheduled** -- Phase 8.1 |
| Images manager (inventory + prune workflows) | Small-Medium | **Scheduled** -- Phase 6.3 |
| Watch non-running / static images | Small-Medium | **Scheduled** -- Phase 6.4 |
| Auto-heal / self-healing orchestration | Medium | **Scheduled** -- Phase 9.4 ([Discussion #198](https://github.com/CodesWhat/drydock/discussions/198)) |
| Web terminal / container shell | Medium | **Scheduled** -- Phase 10.1 |
| Container file browser | Medium | **Scheduled** -- Phase 10.2 |
| Volume browser | Medium | **Scheduled** -- Phase 7.6 |
| Digest pinning advisory | Small | **Partially covered** — compose digest pinning in Phase 3.6.4; standalone advisory for non-compose containers remains backlog |

### Tier 4 -- Developer experience & automation

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Replace Passport.js with custom auth middleware | Medium | **Scheduled** -- Phase 11.0 |
| API keys (scoped, rotatable) | Medium | **Scheduled** -- Phase 11.1 |
| Passkey authentication (WebAuthn) | Medium | **Scheduled** -- Phase 11.1.1 |
| TOTP two-factor authentication | Small-Medium | **Scheduled** -- Phase 11.1.2 |
| OpenAPI / Swagger documentation | Medium | **Shipped** (v1.4.0 — OpenAPI 3.1.0 spec at `GET /api/v1/openapi.json`) |
| TypeScript scripting / Actions | Large | **Scheduled** -- Phase 11.3 |
| Drydock CLI | Medium | **Scheduled** -- Phase 11.4 |

### Tier 5 -- Data safety & ecosystem

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Scheduled automated backups | Medium | **Scheduled** -- Phase 12.1 |
| Compose templates library | Medium | **Scheduled** -- Phase 12.2 |
| Secret management | Large | **Scheduled** -- Phase 12.3 |
| Multiple compose file support | Medium | **Scheduled** -- Phase 12.4 |

### Tier 6 -- Long-term vision

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Git-based stack deployment (basic) | Medium | **Scheduled** -- Phase 8.4 |
| Network topology visualization | Large | **Scheduled** -- Phase 13.1 |
| GPU monitoring (NVIDIA/AMD) | Medium | **Scheduled** -- Phase 13.2 |
| Multi-language / i18n (full translations + RTL) | Medium | **Scheduled** -- Phase 13.3 |
| Image building (Dockerfile editor, registry push) | Large | **Scheduled** -- Phase 10.3 |

### Tier 7 -- Enterprise access & compliance

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Role-based access control (RBAC) | Medium-Large | **Scheduled** -- Phase 14.1 |
| LDAP / Active Directory | Medium | **Scheduled** -- Phase 14.2 |
| Environment-scoped permissions | Medium | **Scheduled** -- Phase 14.3 |
| Audit logging (compliance) | Medium | **Scheduled** -- Phase 14.4 |
| User management (local accounts) | Small-Medium | **Scheduled** -- Phase 14.5 |
| Hardened container image (Wolfi) | Medium | **Scheduled** -- Phase 14.6 |
| FIPS 140-2 compliance mode | Small-Medium | **Scheduled** -- Phase 14.7 |
| Runtime access policy + posture reporting | Medium-Large | **Scheduled** -- Phase 14.8 |

## Phased Plan (Open Work Only)

## Phase 1: Safety & Confidence

**Goal:** Make auto-updates safer so users trust the tool in production.
**Timeline target:** v1.2.x

### 1.1 Maintenance Windows

Restrict when auto-updates can execute. Users configure allowed time windows per watcher or globally.

- `DD_WATCHER_{name}_MAINTENANCE_WINDOW` -- cron expression for allowed update windows (e.g., `0 2-6 * * *` for 2-6am)
- `DD_WATCHER_{name}_MAINTENANCE_WINDOW_TZ` -- timezone (default: UTC)
- Updates detected outside the window are queued and executed when the window opens
- UI shows "next maintenance window" countdown on dashboard

**Status:** complete

- Automated QA (2026-02-12): `app` tests pass, `ui` tests pass, `ui` production build passes; `app`/`ui` lint and `app` TypeScript build remain blocked by pre-existing repository issues outside maintenance-window changes
- Manual QA (2026-02-12): all scenarios passed via Playwright MCP against OrbStack
  - Window open: UI shows "Maintenance window open now" on Watchers card
  - Window closed: UI shows "Next maintenance window in 4h 10m" countdown; API confirms `maintenancewindowqueued=true` for queued-run behavior
  - Timezone: `0 10 * * * Asia/Tokyo` correctly resolves to 01:00 UTC; countdown displays accurately

**Effort:** Low

## Phase 2: Security Integration — ✅ Shipped in v1.3.0 ([archive](roadmap/archive.md#phase-2-security-integration--shipped-in-v130))

### 2.1 Trivy Vulnerability Scanning — ✅ Shipped in v1.3.0 ([archive](roadmap/archive.md#21-trivy-vulnerability-scanning))
### 2.2 Image Signing Verification — ✅ Shipped in v1.3.0 ([archive](roadmap/archive.md#22-image-signing-verification))
### 2.3 SBOM Generation — ✅ Shipped in v1.3.0 ([archive](roadmap/archive.md#23-sbom-generation))
### 2.4 Update Bouncer — ✅ Shipped in v1.3.0 ([archive](roadmap/archive.md#24-update-bouncer))

## Phase 3: UI Stack Modernization

**Goal:** Keep the existing Vue stack, but remove legacy patterns that increase maintenance cost and developer friction.
**Timeline target:** v1.4.0
**Status:** All shipped in v1.4.0 (3.1-3.4, 3.5-3.8, 3.9 — formerly-deferred items rolled into RC8).

**Backend work (non-UI) included in this phase:**
- Settings store (`app/store/settings.ts`) — new LokiJS collection for user preferences, starting with `internetlessMode: boolean`. Extends existing LokiJS; full store migration deferred to v1.6.0.
- Settings API (`app/api/settings.ts`) — `GET /api/settings` + `PATCH /api/settings` (canonical partial update) with deprecated `PUT` compatibility alias
- Icon proxy with disk cache (`app/api/icons.ts`) — `GET /api/icons/:provider/:slug`, fetches from jsdelivr CDN, caches to `/store/icons/`, respects internetless mode
- Icon caching shipped in v1.4.0

### 3.1–3.4 UI Foundation, Build Cleanup, Testing, Personalization — ✅ Shipped in v1.4.0 ([archive](roadmap/archive.md#314334-ui-foundation-build-cleanup-testing-personalization--shipped-in-v140))
### 3.5 Security Hardening — ✅ Shipped in v1.4.0 ([archive](roadmap/archive.md#hardening--reliability--shipped-in-v140-rc8))
### 3.6 Update Reliability — ✅ Shipped in v1.4.0 ([archive](roadmap/archive.md#hardening--reliability--shipped-in-v140-rc8))
### 3.7 Infrastructure Reliability — ✅ Shipped in v1.4.0 ([archive](roadmap/archive.md#hardening--reliability--shipped-in-v140-rc8))
### 3.8 UI Resilience — ✅ Shipped in v1.4.0 ([archive](roadmap/archive.md#hardening--reliability--shipped-in-v140-rc8))
### 3.9 Runtime Access Hardening — ✅ Shipped in v1.4.0 ([archive](roadmap/archive.md#39-runtime-access-hardening--shipped-in-v140))

## Phase 3.10: Headless Mode & Patch Fixes

**Goal:** Allow drydock to run without serving the UI for lightweight, API-only or agent-only deployments. Also collects any small patch fixes for v1.4.1.
**Timeline target:** v1.4.1

### 3.10.1 Headless Mode (No UI)

Run drydock without serving the Vue SPA frontend. Useful for agent-only deployments, headless monitoring, CI/CD integrations, or resource-constrained environments where the API is consumed directly or via triggers only.

- `DD_SERVER_UI_ENABLED=false` -- disable serving UI static assets and the UI router (default: `true`)
- API routes (`/api/*`) remain fully functional regardless of UI setting
- When disabled: requests to `/` and other UI paths return 404 or a minimal JSON message ("UI disabled, use API")
- Health endpoint (`/health`) remains available regardless of UI setting
- Reduces idle memory footprint (~130 MiB savings based on not loading/serving the SPA bundle)
- Existing `DD_SERVER_ENABLED=false` (disable entire HTTP server) remains unchanged and takes precedence
- HEALTHCHECK in Dockerfile already handles `DD_SERVER_ENABLED=false`; headless mode still serves HTTP so no HEALTHCHECK changes needed
- Update Reddit post and docs to accurately reflect this mode in resource usage comparisons

**Effort:** Small
**Reference:** Reddit post resource comparison claimed "drydock headless" at 71 MiB -- this feature makes that claim real.

### 3.11 Trigger Taxonomy Rename — Phase 1 (Migration CLI + Yellow Warnings)

Rename `DD_TRIGGER_*` env vars to split "triggers" into two clear categories that match industry-standard naming (Home Assistant, Zapier, StackStorm all use trigger → action):

- **`DD_ACTION_*`** — triggers that perform container updates (docker, dockercompose, command)
- **`DD_NOTIFICATION_*`** — triggers that send messages (slack, smtp, discord, ntfy, telegram, etc.)

The current `DD_TRIGGER_*` prefix conflates two fundamentally different concepts. "Trigger" in every other automation tool means the *event* that starts something, not the *response*. User feedback in [#153](https://github.com/CodesWhat/drydock/discussions/153) confirmed this is confusing for new users.

**v1.4.x deliverables:**

- **`drydock migrate-config` CLI subcommand** — scans env vars, mounted compose files, and Docker labels; outputs a mapping of old → new variable names. Supports `--dry-run` (default, show what would change) and `--apply` (rewrite compose files in place). Examples:
  ```bash
  drydock migrate-config --dry-run
  # DD_TRIGGER_SLACK_MYSLACK_TOKEN      → DD_NOTIFICATION_SLACK_MYSLACK_TOKEN
  # DD_TRIGGER_DOCKER_LOCAL_PRUNE        → DD_ACTION_DOCKER_LOCAL_PRUNE
  # DD_TRIGGER_DOCKERCOMPOSE_STACK_FILE  → DD_ACTION_DOCKERCOMPOSE_STACK_FILE

  drydock migrate-config --apply /path/to/compose.yml
  # Rewrites DD_TRIGGER_* to DD_ACTION_*/DD_NOTIFICATION_* in the file
  ```
- **Yellow startup warnings** — follow the existing deprecation pattern: `logger.warn()` at trigger `init()` time with "deprecated and will be removed in v1.7.0" message + `recordLegacyInput()` for Prometheus tracking. Warn once per trigger instance (Set-based dedup, same as legacy Docker label warnings in `legacy-label.ts`).
- **Component metadata** — add `usesLegacyPrefix: true` to trigger `getMetadata()` (same pattern as `usesLegacyHash` in Basic auth) so the API exposes the deprecation flag.
- **UI deprecation banner** — add `AnnouncementBanner` in `AppLayout.vue` for trigger prefix deprecation (same pattern as OIDC HTTP and legacy hash banners). Detection via trigger metadata, dismissible with localStorage key `dd-banner-trigger-prefix-v1`.
- **Docs/UI language update** — distinguish "Notification Triggers" vs "Update Actions" in documentation and UI labels (no env var changes yet, just language clarity)
- Both old and new prefixes accepted — `DD_TRIGGER_*` continues to work with no behavior change

**Classification logic (hardcoded, not configurable):**

| Provider | Old prefix | New prefix | Category |
|----------|-----------|-----------|----------|
| docker | `DD_TRIGGER_DOCKER_*` | `DD_ACTION_DOCKER_*` | Action |
| dockercompose | `DD_TRIGGER_DOCKERCOMPOSE_*` | `DD_ACTION_DOCKERCOMPOSE_*` | Action |
| command | `DD_TRIGGER_COMMAND_*` | `DD_ACTION_COMMAND_*` | Action |
| slack, smtp, discord, telegram, teams, matrix, rocketchat, mattermost, gotify, pushover, ntfy, apprise, ifttt, http, kafka, mqtt, googlechat | `DD_TRIGGER_{type}_*` | `DD_NOTIFICATION_{type}_*` | Notification |

**Effort:** Small-Medium
**Reference:** [#153](https://github.com/CodesWhat/drydock/discussions/153)

## Phase 4: Observability

**Goal:** Add live observability into running containers and instant update detection via registry webhooks.
**Timeline target:** v1.5.0

### 4.1 Registry Webhook Receiver — ✅ Shipped in v1.4.2 ([archive](roadmap/archive.md#41-registry-webhook-receiver--shipped-in-v142))

### 4.2 Real-Time Log Viewer — ✅ Shipped in v1.5.0 ([archive](roadmap/archive.md#42-real-time-log-viewer--shipped-in-v150))

### 4.3 Container Resource Monitoring — ✅ Shipped in v1.5.0 ([archive](roadmap/archive.md#43-container-resource-monitoring--shipped-in-v150))

### 4.4 Authentication Abuse Observability & Guardrails

Instrument and monitor the login path so intentional argon2 timing equalization on username mismatch does not become an operational blind spot under brute-force traffic.

- Add auth Prometheus metrics for login attempts by outcome (`success`, `invalid`, `locked`, `error`) and provider type
- Add auth verification latency histogram and track p95/p99 for `/auth/login` (especially failed-login paths)
- Add explicit counter for basic-auth username mismatch attempts (no username label) to detect enumeration/brute-force spikes
- Add dashboard/alert guidance tying auth failure surges to process CPU saturation and lockout rates
- Document hardened internet-facing defaults and tuning knobs for `DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS`, `DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS`, `DD_AUTH_LOCKOUT_WINDOW_MS`, and `DD_AUTH_LOCKOUT_DURATION_MS`
- Document reverse-proxy/WAF rate-limit recommendations for `/auth/login` in addition to app-level limiter

**Effort:** Small-Medium

### 4.4.1 DAST in CI (ZAP + Nuclei)

Automated dynamic application security testing in the release workflow.

- Add ZAP baseline scan (`zap-baseline-scan.py`) as a CI job on release branches
- Add Nuclei scan with auto-detect templates as a parallel CI job
- Spin up QA compose, wait for health, run both scanners, tear down
- Fail the job on any ZAP FAIL findings; allow WARN (informational)
- Fail the job on any Nuclei medium+ findings
- Archive HTML/JSON reports as workflow artifacts
- Run on release branches only (not every PR) to keep CI fast

**Effort:** Small

### 4.4.2 Playwright E2E Test Suite

Full browser-based end-to-end test coverage for all critical user flows using Playwright, integrated with the existing QA compose environment.

- **Install Playwright in the `e2e` workspace** — add `@playwright/test` as a devDependency alongside existing Cucumber setup
- **Browser E2E tests for all critical user flows:**
  - Login flow (basic auth credentials + OIDC redirect to provider and back)
  - Dashboard rendering (stat cards, update summary, widget layout and content)
  - Container list (filtering, grouping by stack/label, search, grid/list view modes)
  - Container detail panel (Overview, Logs, Environment, Labels, Actions tabs)
  - Actions tab: correct trigger association (compose affinity), Update/Preview/Scan action buttons
  - Security view (CVE severity breakdown, SBOM display and download)
  - Config view (tab switching between registries/triggers/watchers, URL deep-linking to specific tabs)
  - Registry, Trigger, and Watcher views (list rendering, status indicators)
  - Audit log (filtering by action type, pagination, date range picker)
  - Navigation between all views (sidebar links, breadcrumbs, back/forward)
  - Real-time SSE updates (verify container status changes propagate to UI without refresh)
- **Integrate with QA compose environment** — tests run against `test/qa-compose.yml` stack with labeled test containers; `docker compose up` in CI before test execution, health-check wait, teardown after
- **Add Playwright to lefthook pre-push pipeline** — new step after existing `e2e` step in the piped sequence (`ts-nocheck` → `biome check` → `qlty check` → build+test → e2e → **playwright** → zizmor → snyk)
- **Add to CI release workflow** — parallel job alongside existing test jobs; archive HTML report and trace artifacts on failure

**Effort:** Medium-Large

### 4.4.3 Auth Registration Error Surfacing — ✅ Shipped in v1.4.1 ([archive](roadmap/archive.md#443-auth-registration-error-surfacing--shipped-in-v141))

### 4.4.5 Podman & Docker Security Documentation — ✅ Completed locally; ships in v1.6 (the standalone v1.5.2 docs lane was dropped — folded into v1.6)

Completed 2026-06-30 as documentation-only release hygiene. The current docs now cover Podman's Docker-compatible API path, Docker socket security access modes, remote Docker over TLS, OIDC remote watcher auth, SELinux/socket troubleshooting, and the distinction between Podman compatibility guidance and future native Podman support.

Original scope: document how to run Drydock with Podman's Docker-compatible API, and fill gaps in Docker socket security documentation. Users are already trying Podman (#152) and hitting configuration issues, and several supported security features (rootless Docker, remote TLS, OIDC remote auth) lacked practical setup guides.

**Completed Podman coverage:**
- Added a Podman quick start section to watcher configuration docs (rootless/rootful socket paths)
- Documented Podman socket-proxy and TCP setup patterns, including `SOCKET_PATH=/run/podman/podman.sock`
- Added FAQ entries for common Podman issues (socket path differences, rootless networking, `podman.sock` vs `docker.sock`)
- Documented known limitations and tested Podman versions
- Cross-referenced Podman guidance from Docker socket security docs
- Kept the scope explicit: documentation and Docker-compatible API guidance only. Full native Podman support (auto-detection, CI test matrix, provider-specific behavior) remains future roadmap work.

**Completed Docker security coverage:**
- **Rootless Docker guide** — setup instructions for rootless Docker daemon with Drydock (socket path at `$XDG_RUNTIME_DIR/docker.sock`, user groups, cgroup delegation, known limitations)
- **Remote Docker over TLS** — end-to-end cert generation walkthrough and Drydock watcher configuration (CA, cert, key files)
- **OIDC remote auth** — practical examples for configuring remote Docker hosts with OIDC token exchange
- **SSH protocol** — documented current non-support for `ssh://` Docker connections so the docs match Joi validation. Implementing SSH support, or removing the stale type, remains a separate code decision.
- **Security posture comparison** — added a table comparing socket mount vs proxy vs remote TLS vs rootless Docker across attack surface, privilege level, and operational complexity

**Effort:** Medium
**Reference:** [#152](https://github.com/CodesWhat/drydock/issues/152)

### 4.6 Image Maturity / Update Age Indicator & Container Sort-by-Age — ✅ Shipped in v1.4.2 / v1.5.0 ([archive](roadmap/archive.md#46-image-maturity--update-age-indicator--container-sort-by-age--shipped-in-v142--v150))

### 4.7 URL-Driven Filter/Sort State — ✅ Shipped in v1.5.0 ([archive](roadmap/archive.md#47-url-driven-filtersort-state--shipped-in-v142--v150))

### 4.8 Release Notes in UI & Notifications — ✅ Shipped in v1.5.0 ([archive](roadmap/archive.md#48-release-notes-in-ui--notifications--shipped-in-v142--v150))

### 4.9 Smart Tag Suggestion for `latest` Containers — ✅ Shipped in v1.4.2 ([archive](roadmap/archive.md#49-smart-tag-suggestion-for-latest-containers--shipped-in-v142))

### 4.10 Digest Check Deduplication — ✅ Shipped in v1.4.2 ([archive](roadmap/archive.md#410-digest-check-deduplication--shipped-in-v142))

### 4.11 Registry 429 Retry with Retry-After + Exponential Backoff — ✅ Shipped in v1.5.0 ([archive](roadmap/archive.md#411-registry-429-retry-with-retry-after--exponential-backoff--shipped-in-v150))

### 4.12 CI Workflow Consolidation — ✅ Shipped ([archive](roadmap/archive.md#412-ci-workflow-consolidation--shipped))

### 4.13 Load Test Production Readiness — ✅ Shipped ([archive](roadmap/archive.md#413-load-test-production-readiness--shipped))

### 4.14 Diagnostic Debug Dump — ✅ Shipped in v1.5.0 ([archive](roadmap/archive.md#414-diagnostic-debug-dump--shipped-in-v150))

### ~~4.15 Homepage Widget (gethomepage.dev)~~ — DEFERRED ([archive](roadmap/archive.md#415-homepage-widget-gethomepagedev--deferred))

## Phase 4.5: Scanner Runtime Decoupling & Grype (INSERTED) — 🚧 Remaining / not implemented

**Audit status (2026-07-12):** the current runtime is still Trivy-only and SBOM documents remain inline. The #490 long-scan correctness package is implemented locally; scanner backend decoupling, Grype, asset lifecycle, and SBOM off-heap storage remain incomplete and must not appear in public completed-v1.6 scope.

**Goal:** Keep safe-pull security gates enabled without requiring bundled scanner binaries, and add Grype as a first-class scanner provider.
**Timeline target:** v1.6.0
**Depends on:** Phase 2.1-2.4 (existing Update Bouncer flow), Phase 4.1-4.3 (v1.5.0 platform work)

### 4.5.1 Scanner Execution Backends

Decouple scanner execution from the drydock runtime so one default image can support multiple operating modes.

- Add execution backends: `command` (existing local CLI), `docker` (ephemeral scanner containers), and `remote` (Trivy server)
- Add backend selection config and pinned scanner image references (digest-first)
- Add explicit scanner availability policy (`block` fail-closed default, optional `warn` advisory mode)
- Expose runtime status indicators for backend health, last successful scan, and remediation guidance

**Effort:** Medium

### 4.5.2 Grype Provider Support

Add Grype as a supported scanner provider with normalized output for existing gate logic.

- Support `DD_SECURITY_SCANNER=trivy|grype|both`
- Normalize severity mapping and vulnerability schema so blocking criteria and API payloads remain consistent
- Preserve Update Bouncer comparison modes (`any`, `critical`, `critical_high`, `more_than_current`) across providers
- Add provider-specific CLI argument defaults with override support

**Effort:** Small-Medium

### 4.5.3 Asset Lifecycle & Operator UX

Provide explicit controls to fetch and update scanner assets without shipping large scanner binaries in-app.

- Add UI/API action to pull or update scanner worker images (with version and digest visibility)
- Warm scanner databases on demand and surface cache status/age
- Audit scanner asset updates and expose failure diagnostics in UI/logs

**Effort:** Small-Medium

### 4.5.3.5 Scanner Long-Scan UX — 🟡 #490 correctness implemented; optional progress UX remains

**Timeline target:** v1.6.0 (queued post v1.5-rc17). Driven by QA findings: large images (multi-GB ML/CUDA) hit the former default 120s Trivy timeout, and the lifecycle blocked silently with no progress indication. Cache reuse in the gate path was wired in v1.5-rc17. **The correctness package for [#490](https://github.com/CodesWhat/drydock/issues/490) is now implemented locally:** 600s default, Node timeout grace with honest errors, one transient retry, block-only pruning, serialized local DB warm-up, and server-mode documentation. Heartbeat and in-progress UI below remain optional follow-up UX rather than #490 correctness gates.

- **Heartbeat / progress logging.** Wrap the Trivy subprocess in a 30s tick that logs "still scanning {image} ({elapsed}s)" so long-running scans no longer look hung in operator logs. Stop the tick on subprocess exit. Implementation goes in `app/security/scan.ts` `runCommand` (extend with an `onTick` option) so cosign benefits too.
- **✅ Default Trivy timeout bump.** `DD_SECURITY_TRIVY_TIMEOUT` now defaults to 600s and remains configurable; current security docs and FAQ use the new value.
- **In-progress "Scanning…" UI status.** When `SecurityGate.maybeScanAndGateUpdate` starts and the scan is not from cache, surface a transient `securityScanState: 'scanning'` field on the container row (cleared on terminal). UI renders a "Scanning…" pill in the same slot as today's scan-state badge. Wire via `dd:sse-container-updated` not a new SSE — minimise event surface.
- **Optional: stream Trivy stderr.** Trivy in non-quiet mode emits `INFO Vulnerability scanning is enabled` etc. on stderr. Useful debug info for slow scans. Gate behind `DD_SECURITY_DEBUG=true` to avoid log noise in normal operation.
- **✅ (#490) Double-timeout-layer race fixed.** Trivy owns the configured deadline; Node waits an additional 30 seconds and explicitly reports process timeouts instead of `exit=unknown`.
- **✅ (#490) Scanner errors retain the pulled image.** `prune.onBlock` now applies only to `security-scan-blocked`; timeouts and other scanner failures remain fail-closed without forcing a re-pull.
- **✅ (#490) One transient retry.** The update-gate path retries only classified transient command failures once, before the existing 15-minute error floor is recorded. Configuration, auth, parse, and vulnerability-block outcomes are not retried.
- **✅ (#490) Server mode cross-linked.** Current timeout guidance points large-image and repeated-scan users at `DD_SECURITY_TRIVY_SERVER`.
- **✅ (#490) Local DB warm-up.** Application startup begins a best-effort, single-flight `trivy image --download-db-only` operation in both controller and agent modes, serialized with scans; the first local vulnerability scan awaits it before its own command budget begins. Server mode skips local warm-up, and a failed warm-up is cooled down for 15 minutes without preventing the fail-closed scan attempt.

**Effort:** Small (heartbeat + timeout) + Medium (UI status). Heartbeat and timeout can ship independently. The #490 bullets: timeout-layer fix + prune scoping + docs are Small; retry-once is Small-Medium (test the gate paths); warmup sized under 4.5.3.4.

**Policy note (#490):** no fail-open default — a scan *error* failing the update is the fail-closed guarantee working. If a fail-open knob is ever added it must be explicit opt-in.

**Out of scope:**
- Async/poll mode for Trivy — not viable; Trivy CLI is one-shot, no job protocol exists. Cache reuse already covers the "don't redo work" case.

### 4.5.4 Bundled Tool Supply Chain

Upgrade bundled Cosign and pin Trivy/Cosign versions to address Go dependency CVEs found by Grype in the drydock image.

- Upgrade Cosign from Alpine `edge/testing` v2.4.3 to v3.x (install from GitHub releases or switch to Wolfi package)
- Pin Trivy and Cosign to explicit versions in Dockerfile rather than floating Alpine edge packages
- Track Go transitive dependency CVEs in bundled binaries (`golang.org/x/crypto`, `golang-jwt`, `sigstore/fulcio`, `docker/cli`, `otel/sdk`) and update when upstream releases fix them
- Long-term resolution: Wolfi base image (Phase 14.6) provides apko/melange-built packages with patched Go deps and automated CVE rebuild pipeline

**Effort:** Small

### 4.5.6 Trigger Taxonomy Rename — Phase 2 (Warnings + Aliases) — ✅ Shipped in v1.5.0

Ship a non-breaking compatibility layer in v1.5.0 so the new naming works everywhere while legacy naming remains functional through the v1.7.0 removal window.

**v1.5.0 must-ship deliverables:**

- **Env var aliases + precedence**
  - Accept `DD_ACTION_*` and `DD_NOTIFICATION_*` anywhere trigger config is parsed.
  - Keep `DD_TRIGGER_*` fully functional in v1.5.0.
  - If both old and new keys are set for the same setting, prefer the new key and emit one warning for the old key.
  - Continue `recordLegacyInput()` metrics for old-prefix reads.
- **Warning escalation (non-breaking in v1.5.0)**
  - Keep server logging at `warn` level in v1.5.0 with explicit v1.7.0 removal messaging.
  - Escalate UI treatment to red error styling in `AnnouncementBanner` with session-only dismiss (no permanent dismiss key).
  - Expose `usesLegacyPrefix: true` in trigger metadata when legacy keys are consumed.
- **Docker label aliases**
  - Accept `dd.action.include` / `dd.action.exclude` and `dd.notification.include` / `dd.notification.exclude` as aliases for `dd.trigger.include` / `dd.trigger.exclude`.
  - Apply the same precedence rule: new label wins, legacy label warns once.
- **API compatibility**
  - Add `category` (`action` or `notification`) to trigger metadata in existing trigger APIs.
  - Keep `/api/triggers` and `/api/notifications` routes unchanged in v1.5.0 to avoid route collisions with notification-rule APIs.
  - Defer route split (`/api/actions`, `/api/notification-triggers`) to v1.6.0+.
- **Docs and migration**
  - Update docs/examples to prefer `DD_ACTION_*` / `DD_NOTIFICATION_*`.
  - Keep migration guidance explicit about fallback behavior and precedence.
  - Add release-note callout with conversion examples.

**Execution order (target 4 PRs):**

1. Parser aliases + deprecation warnings + unit tests.
2. Docker label aliases + precedence + unit tests.
3. API metadata (`category`) + UI banner/copy updates + UI tests.
4. Docs/deprecations/changelog updates + mixed-config QA.

**Exit criteria:**

- Old-only, new-only, and mixed configs all work in v1.5.0.
- No duplicate warning spam for repeated legacy keys/labels.
- New-prefix precedence is covered by tests.
- v1.7.0 removal path is documented and visible in runtime warnings.

**Depends on:** 3.11 (v1.4.x migration CLI + yellow warnings)
**Effort:** Medium
**Reference:** [#153](https://github.com/CodesWhat/drydock/discussions/153)

### 4.5.5 CI & Migration Hardening

Ensure the new execution model is test-covered and migration-safe for existing installations.

- Add CI coverage for thin/default runtime plus docker/remote scanner backends
- Keep local command backend during migration for compatibility
- Document migration paths from bundled scanner binaries to backend-based scanning
- Add OWASP ZAP baseline DAST scan in GitHub Actions (passive scan against deployed app, report as workflow artifact)

**Effort:** Small-Medium

### 4.5.7 Security Page Inline Update Action — ✅ Shipped in v1.5.0

Surface container-update actions directly on the Security view so reviewers can act on scan findings without navigating away.

- Add an inline "Update" button on security rows when the container has an update available (gated on `updateAvailable === true` from the existing container API)
- Button opens the same update confirmation flow used on the Containers view — no new execution path, just a new entry point
- Honor existing guards: maintenance windows, security gate blocks, manual-confirm requirements
- Disabled state with tooltip explaining why when an update is gated (blocked severity, outside window, etc.)
- Works for both stable-image and agent-watched containers

**Effort:** Small
**Discussion:** [#299](https://github.com/CodesWhat/drydock/discussions/299)

## Phase 5: Notifications & Release Intel

**Goal:** Richer, customizable notifications with embedded release context.
**Timeline target:** v1.6.0
**Status (2026-07-12):** Core scope is implemented and verified locally on `dev/v1.6`: deprecation removals/deferrals, notification templates + preview, notification-bell preferences, cross-device preference sync, release-note context, digest delivery, bidirectional MQTT, health-status events, and #325's Update Status panel/global update mode. It is not released yet. Ntfy enhancements remain backlog; the #321 storage/dry-run/preview slices are explicit open scope decisions rather than completed work.

### 5.0 Deprecation Removals

All items deprecated in v1.2.0–v1.4.0 are removed in v1.6.0:

**✅ DONE (2026-07-12):** runtime compatibility was removed for legacy Basic hashes, HTTP OIDC discovery, WUD environment/label aliases, watcher digest/startup switches, trigger-template aliases, Kafka `clientId`, and malformed token-only Hub/DHI public instances. Valid registry `LOGIN`+`TOKEN` remains supported. The migration CLI deliberately retains WUD knowledge only for offline rewrites. `PUT /api/v1/settings` remains deprecated until API v2, the standalone auth aliases follow their documented v1.7/v1.8 schedules, and Phase 3 trigger-taxonomy inputs remain functional with error-level warnings until v1.7.

- **Remove legacy basic auth hash support** — `{SHA}`, APR1/MD5, crypt, and plain-text password hashes deprecated in v1.4.0 are removed. Only argon2id hashes are accepted.
- **Remove HTTP OIDC discovery support** — `http://` discovery URLs deprecated in v1.4.0 are removed. Only `https://` accepted.
- **Defer PUT /api/settings removal to API v2** — `/api/v1` is frozen; keep the deprecated method and its headers, and direct callers to PATCH.
- **CORS implicit wildcard origin fallback** — already removed in v1.5.0-rc.9; keep explicit-origin enforcement.
- **Remove unversioned `/api/*` path alias** — only `/api/v1/*` accepted.
- **Remove legacy `wud.*` Docker label fallbacks** — only `dd.*` labels accepted.
- **Remove legacy `WUD_*` environment variable fallbacks** — only `DD_*` env vars accepted.
- **Remove `DD_WATCHER_{name}_WATCHDIGEST` env var** — use `dd.watch.digest=true` container label instead.
- **Remove `DD_WATCHER_{name}_WATCHATSTART` env var** — Drydock watches at startup by default.
- **Remove legacy trigger template variables** — `$id`, `$name`, `$watcher`, `$kind`, `$semver`, `$local`, `$remote`, `$link`, `$count` replaced by `$container.*` and `$containers.length`.
- **Remove Kafka trigger `clientId` compatibility key** — only lowercase `clientid` is accepted.
- **Remove malformed token-only Hub/DHI public-instance fallback** — `PUBLIC_TOKEN` without `PUBLIC_LOGIN` now fails validation instead of becoming anonymous; valid LOGIN+TOKEN, LOGIN+PASSWORD, and AUTH remain supported.
- **Deprecate `DD_TRIGGER_*` env var prefix (Trigger Taxonomy Rename — Phase 3)** — `DD_TRIGGER_*` still works but logs `error`-level deprecation at startup on every occurrence. All docs, UI, and API responses use `DD_ACTION_*` / `DD_NOTIFICATION_*` exclusively. `dd.trigger.include` / `dd.trigger.exclude` Docker labels still accepted but deprecated. Removal targeted for v1.7.0. Run `node dist/index.js config migrate --source trigger` to convert.
- **Docs nav: Actions vs Notifications** — **Copy clarified for v1.6:** the existing `/configuration/triggers` section is titled **Actions & Notifications**, and the configuration landing page distinguishes update-action providers from container-operation actions. A physical provider-page move remains deferred because it requires URL + heading-anchor redirects to preserve inbound links; do not move the three action-provider URLs during the release docs pass.

**Effort:** Small

### 5.1 Notification Channels (Ntfy Improvements) — MS Teams & Matrix already shipped

MS Teams and Matrix trigger providers shipped prior to v1.5.0. Remaining work:

- Ntfy enhancements (topic routing, priority levels, action buttons)

**Effort:** Low

### 5.2 Notification Templates

User-customizable notification message templates for all trigger providers.

**✅ DONE (2026-07-12):** notification rules persist per-trigger overrides for simple title, simple body, and batch title. The existing sandboxed `${...}` renderer supplies the canonical container/update/security/release-note context, the Notifications UI edits and previews each provider's override against representative event data, and provider configuration remains the fallback when no override exists.

- Sandboxed `${...}` template syntax shared with existing trigger templates
- Per-trigger template override (customize Slack format differently from Discord)
- Built-in template variables: container name, image, old tag, new tag, CVE summary, release notes
- Template preview in UI before saving
- Existing provider templates remain the default (no breaking changes)

**Effort:** Medium

### 5.3 Release Notes in Notifications

**MOVED to Phase 4.8 (v1.5.0)** — see Phase 4.8 for full details.

**Effort:** Medium

### 5.4 Scheduled Digest Notifications — ✅ Shipped in v1.5.0

The digest mode described below is already implemented and released. It remains here only as historical scope; new examples use the notification taxonomy.

Add a `digest` trigger mode that accumulates update events over a configurable time window and sends a single summary notification on a cron schedule, instead of firing after every watcher scan.

- New trigger mode: `DD_NOTIFICATION_SMTP_{name}_MODE=digest` (alongside existing `simple` and `batch`)
- Configurable digest schedule: `DD_NOTIFICATION_SMTP_{name}_DIGEST_CRON=0 8 * * *` (default: daily at 8am)
- Digest buffer collects container update events; flushes on cron tick
- Deduplicates: if the same container has multiple updates within the window, only the latest is included
- Works for all notification triggers (SMTP, Telegram, Slack, Pushover, etc.)
- Existing `batch` mode is unchanged (fires per scan cycle)

**Effort:** Medium
**Discussion:** https://github.com/CodesWhat/drydock/discussions/185

### 5.5 Notification Preferences UI + Cross-Device Preference Sync

User-configurable notification bell preferences AND server-side persistence for all dashboard/UI preferences so they sync across devices.

#### 5.5a Notification Bell Preferences

**✅ DONE (2026-07-12):** `NotificationRule` now persists `bellEnabled` and `bellThreshold`; the Notifications detail panel edits both beside delivery routing and template overrides. The bell applies the configured event-category filters, with `major` / `minor` / `patch` / `all` thresholds for update-available audit entries.

- **Bell category toggles** — enable/disable audit-backed categories: Updates (available/applied/failed), Security Alerts, Agent Disconnects, and Container Unhealthy. Notification-delivery failures are always included; Agent Reconnect remains delivery-only because it has no bell audit action.
- **Severity threshold** — e.g., only show `major` update notifications in bell, suppress `patch`
- **Maps to existing NotificationRule system** — extend rules with a `bellEnabled` flag and `bellThreshold` field
- **Config UI** in Configuration > Notifications tab (extends existing NotificationsView)
- **Research basis:** Portainer bell shows only actionable alerts (50 max); Grafana routes by label matchers + mute timings; Uptime Kuma has per-monitor notification assignment. Drydock follows Portainer pattern: admin-level category config, not per-user.

**Background:** Discussion #205 concerned the meaning and noise level of outgoing update notifications; it did not request the in-app bell controls. The bell work is tracked independently.

#### 5.5b Cross-Device Preference Sync

Persist all UI preferences (theme, layout, columns, dashboard grid, sort/filter state) server-side so they sync across browsers/devices. Opt-in toggle per begunfx's request — some users want different prefs per device.

**✅ DONE:** per-user versioned storage, authenticated `GET`/`PATCH /api/v1/preferences`, opt-in Appearance toggle, debounced writes, two-phase hydration, and SSE propagation are implemented. Anonymous sessions remain local-only.

**Backend:**
- New `app/store/ui-preferences.ts` — LokiJS collection keyed by `username`, upsert pattern (findOne + update-or-insert)
- New `app/api/preferences.ts` — GET (load by username) + PATCH (merge by username) Express router, mounted at `/api/v1/preferences`
- Wire into `app/store/index.ts` createCollections + `app/api/api.ts` router mount

**Frontend:**
- New `ui/src/services/preferences.ts` — API client for GET/PATCH
- Modify `ui/src/preferences/store.ts` — two-phase hydration: (1) localStorage instant load for appearance CSS, (2) server merge after auth, only re-apply CSS if values changed
- Server write debounce: 2-5s (separate from 100ms localStorage flush) to avoid write storms during dashboard drag/resize
- Wire `PREFERENCES_API_VERSION = 1` into API request/response contract
- Skip server-sync for `username='anonymous'` — fall back to localStorage-only

**UI placement:** Toggle lives in `/config?tab=appearance` (`ConfigAppearanceTab.vue`) as a "Sync across devices" `ToggleSwitch` at the top of the tab, above the Color Theme section. This is the natural home because:
- The Appearance tab already controls all "how does my Drydock look" settings (theme, font, icons, radius)
- Follows the same pattern as "Internetless Mode" toggle in the General tab — single switch that changes a system behavior
- Does NOT go in the dashboard customize slide-in panel — that panel is specifically for widget layout (show/hide, drag/resize), and sync is a global preference affecting all settings, not just dashboard
- When toggled **on**: initial push of current localStorage prefs to server, then all future changes sync
- When toggled **off**: server copy retained but stops syncing, localStorage becomes authoritative again

**Constraints:**
- Anonymous mode (DD_ANONYMOUS_AUTH_CONFIRM=true) uses shared `anonymous` username — server-sync disabled, toggle hidden
- Last-write-wins for concurrent tabs (acceptable for v1; ETag-based conditional updates if needed later)
- SSE `dd:preferences-updated` broadcast for real-time cross-device push (optional, adds polish)
- LokiJS → SQLite migration at v1.8 — simple key-value collection migrates trivially

**Discussion:** https://github.com/CodesWhat/drydock/discussions/220
**Effort:** Medium (shared infrastructure with 5.5a — both need server-side preference storage)

### 5.6 Docs Site Styling Overhaul

Fix layout/styling friction (fixed-width overrides, banner rework) by studying how Vercel's SWR docs site achieves a clean design with the same Fumadocs stack.

- Stay on Fumadocs — SWR (`vercel/swr-site`) uses identical packages (`fumadocs-core` 16.x, `fumadocs-ui` 16.x, `fumadocs-mdx` 14.x) and looks great
- Study SWR's layout overrides, CSS customization, and component composition
- Fix fixed-width content constraint to allow full-width or wider layouts
- Rework banner component to align with Fumadocs patterns (stop fighting the framework)
- Apply any other styling improvements discovered from the SWR reference

**Effort:** Small
**Reference:** `vercel/swr-site` on GitHub

### 5.7 Software Version Column (OCI Metadata) — ✅ Shipped in v1.5.1

Display the actual software version alongside the image tag in the container list. Currently Drydock conflates the two — `dd.inspect.tag.path` replaces the image tag instead of showing both.

- **Auto-extract `org.opencontainers.image.version`** from Docker inspect data when present (no user label needed)
- **New `image.softwareVersion` field** — stored separately from `image.tag.value`, returned in API response
- **UI: dual display** — "Tag" column shows the image tag, "Version" column (or secondary line) shows the software version when available
- **`dd.inspect.tag.path` behavior change** — extracted value populates `softwareVersion` instead of overwriting the image tag; original tag is preserved
- **Floating tag synergy** — containers running `latest` (floating) with `org.opencontainers.image.version: 2.3.4` show both, which is exactly where this matters most

**Effort:** Small
**Discussion:** [#209](https://github.com/CodesWhat/drydock/discussions/209)

### 5.8 Bidirectional MQTT for Home Assistant (command_topic) — ✅ Implemented and verified locally for v1.6

Add `command_topic` and `payload_install` to MQTT Home Assistant discovery messages so HA update entities show a native Install button. When clicked, HA publishes to the command topic and Drydock subscribes and executes the container update — the same zigbee2mqtt pattern.

- **Opt-in config flag:** `DD_NOTIFICATION_MQTT_{name}_HASS_COMMANDS=true` (default `false`) — controls both discovery payload and subscription; avoids silent breaking change for existing users
- **Discovery payload:** Add `command_topic` (`{baseTopic}/{watcher}/{name}/cmd`) and `payload_install` (`install`) to `publishDiscoveryMessage()` options when enabled
- **Wildcard subscription:** Single `{baseTopic}/+/+/cmd` subscription in `Hass` constructor (O(1) vs O(N) per-container)
- **Extend `HassClient` interface:** Add `subscribeAsync()`, `on('message')`, `removeListener()` — currently publish-only
- **Message handler guards:** Replicate all webhook guards from `webhook.ts:264-310` — container existence check, rollback container check, audit event recording
- **In-handler rate limiting:** Debounce/throttle per-container to prevent DoS via rapid message flooding (webhook has 30-req/15-min limiter; MQTT has no built-in equivalent)
- **Extract `findDockerTriggerForContainer()`** from `app/api/docker-trigger.ts` into a shared registry-layer utility — avoids API→trigger layer crossing
- **Lifecycle cleanup:** `unsubscribeAsync()` + `removeListener()` in `Hass.deregister()`
- **Security model:** Broker-level auth only (username/password/TLS); no message-level signing. Document broker ACL recommendation.
- **Cosmetic gap:** HA supports `in_progress` / `update_percentage` in state payload for mid-update progress — not included in initial implementation, can be added later

**Effort:** Medium (1 day — bulk is test coverage for new subscribe/handler paths)
**Discussion:** [#210](https://github.com/CodesWhat/drydock/discussions/210)
**Workaround:** Webhook API (`POST /api/v1/webhook/update/:containerName`) via HA `rest_command` — documented in discussion reply

### 5.8.1 First-party Home Assistant Lovelace card (optional, backlog — only if it makes sense)

A drydock-native HA dashboard card (container list + update status + update button against `/api/v1`). **Settled 2026-07-03 (#469 session): making the EXISTING wud-card work via `DD_COMPAT_WUDCARD` (v1.6) IS the plan** — this item is an option we can pick up later "if it makes sense" (user), NOT a commitment. No public promise exists (the #469 reply deliberately makes none). We do NOT contribute to angryvoegi/wud-card ("we are no longer WUD").

- **Status: optional/backlog, no gate, no schedule.** Revisit if compat-flag maintenance gets painful or organic demand shows up. HACS cards are self-published — no upstream approval exists. (Historical note: the "~20 upvotes" framing was a conflation with the *Homepage widget* upstream gate — gethomepage requires 20+ upvotes on [gethomepage/homepage#6440](https://github.com/gethomepage/homepage/discussions/6440), 5/20 as of 2026-07-03 — see deferred item 4.15. The compat flag also shims Homepage's `whatsupdocker` widget.)
- If ever built: talks to `/api/v1` natively (envelope-aware), HACS-distributable, first-party voice; pairs with 5.8 bidirectional MQTT and 11.1 API keys

**Effort:** Medium
**Discussion:** [#469](https://github.com/CodesWhat/drydock/discussions/469)

### 5.9 Security Scan Digest — ✅ Shipped in v1.5.0 ([archive](roadmap/archive.md#59-security-scan-digest--shipped-in-v150))

### 5.10 Update Status Panel — Slide-In Redesign + Update Mode Setting — ✅ Implemented locally

**Status (2026-07-12): implemented on `dev/v1.6`, not released.** The side-panel and full-page detail surfaces now use an actionable Update Status panel, and the server has a global `notify | manual | auto` mode. Discussion #325's public v1.6 commitment is code-complete pending release convergence and the normal GA follow-up.

**Context:** v1.5.0-rc.16 dropped the eligibility-pill column from the table view (the "Trigger Filtered" / "Agent Mismatch" / etc. badges that surfaced as noise on every row — see [Discussion #325](https://github.com/CodesWhat/drydock/discussions/325)). State moved onto the Update action button: ☁️ ready, ☁️⚠️ soft-blocked (manual still works), 🔒 hard-blocked. The v1.6 work then replaced the remaining legacy stack in both detail panes with the structured panel described below.

The former pill stack mapped 1:1 to backend reasons. The implemented panel covers all 16 current reason codes with one summary state plus a structured conditions list in the detail view.

**Components:**

- **`UpdateStatusPanel.vue`** — replaces the `<UpdateEligibilityBadges variant="full">` stack in `ContainerSideTabContent.vue` and `ContainerFullPageTabContent.vue`. Layout:
  - **Status header** — single plain-language sentence: "Up to date", "Update available — eligible for automatic dispatch", "Update available — auto-dispatch is filtered (manual works)", "Update blocked — fix required". One verb, derived from the highest-severity blocker. Eligibility is not a guarantee of immediate deployment: watcher timing, queues, maintenance windows, security checks, and agent availability can still delay dispatch.
  - **Conditions list** — typed entries (icon + heading + body + action link), one per active blocker. Actions open the in-app update-policy editor, operation history, Security view, or filtered Audit view where those surfaces exist. Configuration-owned conditions (`agent-mismatch`, trigger labels, missing triggers, thresholds, maintenance windows, and self-update availability) link to the relevant external configuration documentation because drydock has no in-app editor for those environment variables or labels.
  - **Maintenance-window visibility** — `maintenance-window-closed` is enriched into both container-list and SSE status payloads for local and agent-owned containers, so the panel can explain an automatic deferral without waiting for a separate watcher event. Manual UI/API updates remain outside this automatic-dispatch gate.
  - **Manual update CTA** — explicit button, separate from auto-update story. Disabled when hard-blocked; warn-and-confirm when soft-blocked.
- **Update mode global setting** — persisted server-side as `updateMode: 'notify' | 'manual' | 'auto'`.
  - `notify` — drydock detects + notifies but refuses both automatic and manual update admission with a clear 409 response. The Update Status Panel collapses to "Notifications only — drydock won't apply updates," with conditions behind a "Show details" disclosure and update actions disabled.
  - `manual` — the fresh-install default and the existing manual-interaction behavior. Automatic action-trigger dispatch is suppressed; manual updates remain available, hard blockers lock the button, and soft blockers warn-and-confirm.
  - `auto` — full eligibility model surfaced; conditions are actionable.
  - Surfaced in Settings → General.
  - Fresh installs default to `manual`. Existing settings records with no mode migrate to `auto`, preserving pre-v1.6 automatic action-trigger behavior instead of silently disabling it on upgrade.
- **Severity-color cleanup** — hard conditions now use danger styling instead of rendering quieter than soft warnings; soft conditions remain amber and security remains red.
- **i18n** — all status verbs and condition action labels go through vue-i18n.

**Implementation:**

- `UpdateStatusPanel.vue` and its status derivation replace the detail badge stack in both container detail surfaces.
- `ConfigGeneralTab.vue` exposes the server-wide mode through `/api/v1/settings`; backend trigger dispatch and manual update admission enforce it.
- Locale catalogs, update-button presentation, settings/OpenAPI contracts, compatibility migration, and regression tests are updated together.

**Effort:** Medium
**Dependencies:** none — independent of declarative update policy (Phase 5.x), but condition action links land more cleanly once that policy editor exists.
**Discussion:** [#325](https://github.com/CodesWhat/drydock/discussions/325)

### 5.11 Store Size Investigation — SBOM Off-Heap + Bounded Audit Retention — 🚧 Not implemented

**Context:** [Discussion #321](https://github.com/CodesWhat/drydock/discussions/321) — user reported `dd.json` reaching ~44 MB on a near-fresh install with 94 containers within hours. The reporter renamed the store to start fresh and it grew that fast, so this isn't 30 days of history accumulating.

**Primary root cause (confirmed by code read):** SBOM documents are stored **inline on the container record**. `generateImageSbom` in `app/security/scan.ts:627-679` calls `JSON.parse(sbomOutput)` per format and stores the entire parsed document tree under `sbomResult.documents`. The container schema at `app/model/container.ts:108-115` then persists both `security.sbom` (current image) **and** `security.updateSbom` (target image) on every container row, validated by `containerSecuritySbomSchema` (`app/model/container.ts:232-241`, `documents: joi.object().required()`).

Reporter's config has all three SBOM amplifiers enabled:
```
DD_SECURITY_SBOM_ENABLED=true
DD_SECURITY_SBOM_FORMATS=spdx-json,cyclonedx-json
DD_SECURITY_SCANNER=trivy
```

Math: 94 containers × 2 documents (current + update) × 2 formats × ~50–500 KB per SBOM = **~19–190 MB** persisted in `dd.json`. 44 MB sits at the low end of that range — exactly what we'd expect for a fleet weighted toward Alpine-based images. SBOM documents are also static per (image digest, format) — storing one copy per container is pure waste when 30 containers share the same `library/postgres:16` digest.

**Secondary contributor (likely 2nd-largest):** `registerContainerReport` in `app/event/audit-subscriptions.ts:87-101` writes a fresh `update-available` audit row **every cron tick for every container with `updateAvailable=true`**, with **no deduplication**. 94 containers × 28 with updates × hourly cron = 672 audit rows/day. Over 30 days (`AUDIT_RETENTION_DAYS=30` in `app/store/audit.ts:8`) that's ~20K rows from one subscription. Order of magnitude smaller than SBOM, but worth fixing for the lower-fleet-size users where SBOM isn't dominant.

**Tertiary:** LokiJS persists as un-minified JSON with no compression (`app/store/index.ts:91-94`, `autosave: true, autosaveInterval: 60000`). Each row carries Loki metadata (`$loki`, `meta`) on disk. Pretty-printed JSON is ~30-40% larger than minified.

**Fix plan:**

1. **SBOM off-heap storage (primary fix).** Stop storing SBOM document bodies in the LokiJS row. Persist documents to disk at `/store/sbom/<sha256-of-image-digest>/<format>.json` and store only `{ generator, image, generatedAt, status, formats, documentRefs: { 'spdx-json': '<path>', 'cyclonedx-json': '<path>' } }` on the container row. Content-addressable: identical image digests share the same file, so 30 postgres containers share one SBOM blob each. Add a startup migration that rewrites existing inline SBOM rows to the new format.
2. **SBOM API path** — `GET /api/v1/containers/:name/sbom?format=spdx-json` reads from disk on demand; UI lazy-loads only when the security tab is opened. Update existing handlers in `app/api/container/handlers/security.ts` (or sibling) to dereference instead of returning inline.
3. **Per-collection size attribution.** Extend `getDebugSnapshot()` in `app/store/index.ts:186` to report serialized byte size per collection, not just document count. Surface in the diagnostic dump (Phase 4.14, shipped v1.5.0). Without this, future bloat is opaque again.
4. **Audit row dedup (secondary fix).** `update-available` should fire on **state transition** (no→yes or version change), not every cron tick. Mirror the dedup pattern already used in `registerSecurityAlert` (5-min window) and `registerAgentDisconnected` (1-min window). Key: `containerName|fromVersion|toVersion`. Configurable via `DD_AUDIT_UPDATE_AVAILABLE_DEDUPE_MS` (default 1h to match typical cron cadence).
5. **LokiJS write-side compaction.** Investigate `serializationMethod: 'destructured'` and/or periodic `db.flush()` + rewrite cycle. Low-priority once #1 lands but worth measuring.

**Acceptance criteria:**

- SBOM bodies live at `/store/sbom/<digest>/<format>.json`, container row carries only refs.
- Startup migration converts existing inline SBOMs without data loss.
- Content-addressable dedup: identical image digests share one blob on disk.
- `getDebugSnapshot()` reports per-collection byte size; diagnostic dump includes it.
- After 24h of normal operation against QA stack with ~50 containers AND SBOM on, total `dd.json` stays under 2 MB; SBOM directory stays bounded by unique-digest count, not container count.
- Audit dedup window for `update-available` is configurable; audit collection grows by O(state-transitions/day), not O(containers × cron-ticks/day).
- 100% test coverage on SBOM read/write paths, ref dereferencing, migration, and audit dedup.

**Effort:** Medium (SBOM off-heap is the bulk; audit dedup and instrumentation are Small each).
**Discussion:** [#321](https://github.com/CodesWhat/drydock/discussions/321)

### 5.12 Dry-Run UX Surfacing — 🚧 Not implemented

**Context:** Same [Discussion #321](https://github.com/CodesWhat/drydock/discussions/321). Reporter had `DD_TRIGGER_DOCKER_LOCAL_DRYRUN=true` registered (likely from Portainer stack env or a stale `.env`) and the only signal was an INFO-level log line — `Do not replace the existing container because dry-run mode is enabled` — emitted per-container per-tick. They concluded "auto-update doesn't work" and spent days debugging before realizing dry-run was on.

**The fix is multi-surface, because the foot-gun is:**

1. The trigger registration log (`Register with configuration {...,"dryrun":"true"}`) is also INFO and easy to miss in startup noise.
2. The "did not replace" log is INFO and only visible if you're tailing logs.
3. The UI doesn't show that an action trigger is in dry-run mode anywhere — not on the trigger card, not on container rows, not on the Update button.

**Changes:**

- **Backend:** raise the per-update "did not replace … dry-run" message to **WARN** in `app/triggers/providers/docker/Docker.ts` (around the existing INFO call near line 1004-1017). Dry-run is an operator opt-in that prevents user-expected behavior; it deserves a sticky log level.
- **Trigger card / settings page (`ui/src/views/...`):** when an action trigger has `dryrun: true`, render a yellow "Dry-run mode" pill on the trigger card with tooltip "Updates are previewed only — containers will not be replaced. Set DRYRUN=false to apply."
- **Container row / Update Status Panel (Phase 5.10):** when the container's effective action trigger is in dry-run mode, the Update action button shows ☁️🛈 (preview-only icon) with tooltip "This trigger is in dry-run mode — clicking will pull the new image but not replace the container." The Update Status Panel adds a "Trigger configuration" condition: "Action trigger `<id>` is in dry-run mode."
- **Audit:** dry-run "would-have-replaced" events should still write an audit row with `action=update-applied-dryrun` (distinct action, not silent), so the user has a record in the History tab that the trigger would have fired.

**Acceptance criteria:**

- Per-container dry-run log is WARN-level.
- Trigger card shows dry-run pill when `DRYRUN=true`.
- Update button shows preview-only state when resolved trigger is in dry-run mode.
- Audit log distinguishes `update-applied` from `update-applied-dryrun`.
- 100% test coverage on the new audit action and UI states.

**Effort:** Small-Medium (mostly UI surfaces; backend logger bump and audit action are trivial).
**Discussion:** [#321](https://github.com/CodesWhat/drydock/discussions/321)

### 5.13 Preview Update Error Transparency — 🚧 Not implemented

**Context:** Same [Discussion #321](https://github.com/CodesWhat/drydock/discussions/321). Reporter clicked "Preview Update" and got a generic failure error with no actionable detail. They attributed it to misconfigured env vars (which were unrelated — they had switched from `DD_TRIGGER_*` to `DD_NOTIFICATION_*`/`DD_ACTION_*` on a version that didn't recognize the new prefixes), but the error UI gave them no way to confirm or rule that out.

**Symptoms to reproduce:**

- Configure docker action trigger with valid registry but bad credentials → click Preview Update → expect "Authentication failed for `<registry>`: 401 Unauthorized" not "Preview failed".
- Configure docker action trigger with no registry config for a private image → click Preview Update → expect "No matching registry configured for `ghcr.io/private/image`" not "Preview failed".
- Run on a version (e.g. 1.4.5) that doesn't recognize the configured trigger prefix at all (zero registered action triggers) → click Preview Update → expect "No action trigger configured — add one in Settings → Triggers" not "Preview failed".

**Changes:**

- **Backend:** Preview endpoint (`app/api/container/handlers/actions.ts` or sibling) must catch and surface specific failure modes: no trigger registered, registry auth, registry not found, network error, manifest error. Each gets a stable `code` field in the JSON response (e.g. `no-trigger-configured`, `registry-auth-failed`, `registry-not-found`, `manifest-fetch-failed`), `message` (human-readable), and `details` (sanitized stack/registry response).
- **Frontend:** Toast or modal on Preview failure includes the message + "Open trigger settings" / "Open registry settings" deep-link buttons keyed off the `code`.
- **Tests:** Add coverage for each failure mode end-to-end (mock registry returning 401/404/network error).

**Acceptance criteria:**

- Preview Update never shows a generic "failed" error in the UI; every failure path has a typed `code` and human message.
- Failure responses include a deep-link target where possible.
- 100% test coverage on the new error codes.

**Effort:** Small.
**Discussion:** [#321](https://github.com/CodesWhat/drydock/discussions/321)

### 5.14 Compose-File Matching Robustness

**Context:** [Issue #365](https://github.com/CodesWhat/drydock/issues/365). When Drydock runs alongside another stack manager (commonly Portainer), both bind-mount the *same* host compose directory but at *different* in-container paths (e.g. Portainer's `/data/compose`, Drydock's `/drydock`). A container's `com.docker.compose.project.config_files` label records the compose-file path as seen by whichever tool last (re)created it. The Docker Compose action trigger compares that label against the configured `DD_ACTION_DOCKERCOMPOSE_{name}_FILE` with an exact string match (`resolveComposeFilesForGrouping`, `app/triggers/providers/dockercompose/Dockercompose.ts:1389` — `composeFiles.includes(configuredComposeFilePath)`). When both paths reference the same file through different mounts the match fails and every affected container is silently skipped (`Skip container ... because compose files ... do not match configured file ...`). The #365 reporter hit this whenever Portainer recreated a container; updating through Drydock's own UI re-stamped Drydock's path and masked the problem.

**Changes:**

- Add a normalized fallback to `resolveComposeFilesForGrouping`: when the exact `includes()` match fails, compare the configured path and the label paths by their trailing `<project-id>/<filename>` segment (the parent compose directory differs only by mount prefix in the Portainer-alongside case).
- Keep the exact match as the fast path so single-tool setups are untouched; the normalized comparison runs only on miss.
- When a container is grouped via the normalized fallback, log at `warn` with both paths so a genuine misconfiguration stays visible to operators.

**Acceptance criteria:**

- A container deployed by Portainer (label `/data/compose/<id>/docker-compose.yml`) is correctly grouped and updated by a Drydock action trigger configured with `/drydock/<id>/docker-compose.yml` when both resolve to the same host file.
- No regression for single-tool setups; an unrelated compose project is still skipped.
- 100% test coverage on the normalized-match path.

**Effort:** Small.
**Issue:** [#365](https://github.com/CodesWhat/drydock/issues/365)

## Phase 6: Smart Updates & UX

**Goal:** Smarter update ordering and quick-win UI improvements that close visible gaps against competitors.
**Timeline target:** v1.7.0

### 6.0 Trigger Taxonomy Rename — Phase 4 (Removal)

Remove all `DD_TRIGGER_*` env var support. Only `DD_ACTION_*` and `DD_NOTIFICATION_*` prefixes accepted.

- **Remove `DD_TRIGGER_*` env var prefix** — startup fails with a clear error message listing exact replacements and pointing to `drydock migrate-config`
- **Remove `dd.trigger.include` / `dd.trigger.exclude` Docker labels** — only `dd.action.include` / `dd.notification.include` (and `.exclude`) accepted
- **Remove `/api/triggers` endpoint** — only `/api/actions` and `/api/notifications` remain
- **Internal code** — `app/triggers/` directory may retain its name internally but all user-facing surfaces (env vars, API, UI, docs, labels, logs) use the new terminology exclusively

**Depends on:** 3.11 (v1.4.x), 4.5.6 (v1.5), 5.0 Phase 3 (v1.6)
**Effort:** Small
**Reference:** [#153](https://github.com/CodesWhat/drydock/discussions/153)

### 6.1 Container Dependency Ordering

Update containers in safe dependency order within a stack. Moved from Phase 5.5 -- both Arcane and Tugtainer already ship this; shipping alongside v1.5 observability features creates a stronger competitive narrative.

- Auto-detect `depends_on` relationships from Docker Compose files
- Manual override via `dd.depends_on=container_a,container_b` labels
- Topological sort for update execution order (databases before apps, apps before proxies)
- Cycle detection with warning
- Respect dependency order in batch and compose trigger operations
- `dd.depends_on.action=update|restart` label — dependents can be restarted without pulling a new image (e.g. Tdarr nodes that must bounce when the parent updates but share the same image tag) — raised in #219
- **Dependency hierarchy view** in container list — containers with dependencies shown in a visual tree so the relationship is clear even outside update context (#219)
- **Confirmation dialog shows dependency chain** — when updating a container that has dependents, the dialog lists all containers that will be affected (restarted/updated) (#219)
- **Child-before-parent guard** — if user tries to update a dependent container without updating the parent, warn that this may cause issues and suggest updating the parent instead (#219)
- **Dependency group actions** — dependency view supports the same actions as stack view (Update All, etc.) (#219)

**Effort:** Medium–Large (upgraded from Medium — UI hierarchy + confirmation dialog + guard logic adds scope)

### 6.1.1 Selective Bulk Container Updates

Add a middle-ground between single-container update and stack-wide `Update all`.
This addresses the repeated request for "select several containers, then update
only those selected" without requiring users to split stacks or run one update
at a time.

- Checkbox selection in container list views (table first, card/grouped views follow the same shared selection model)
- Sticky bulk action bar showing selected count + `Update Selected`
- Selected update action respects existing security bouncer rules, trigger/agent affinity, and disabled-action states
- Confirmation dialog summarizes the exact containers that will be updated, including skipped/blocked selections
- Mixed-stack and mixed-host selections are allowed only when the existing action-routing logic can resolve them safely; otherwise show an explicit explanation
- Initial scope is update-only; the same selection model can later power other bulk actions (`restart`, `scan`, `skip`) without changing the underlying routing model
- Reporter reference: [Discussion #232](https://github.com/CodesWhat/drydock/discussions/232)

**Effort:** Medium

### 6.2 Clickable Port Links

Quick-access links for container exposed ports in the UI. Three competitors (Dockhand, Portainer, Arcane) already ship this -- low effort, high visibility.

- Display exposed ports as clickable hyperlinks in container list and detail views
- Auto-detect protocol (HTTP/HTTPS) based on common port conventions (443, 8443 -> HTTPS)
- `dd.port.label` override for custom port display names
- Open in new tab by default
- Support for host-mapped ports and container-internal ports

**Effort:** Small

### 6.3 Image Prune from UI

Prune unused Docker images directly from the drydock UI. Portainer, Tugtainer, and Arcane already ship this -- low effort quality-of-life feature.

- Dedicated Images manager page (inventory table) with image, tag, size, usage count, and last-seen metadata
- "Prune unused images" button in a new Images section or dashboard action bar
- Confirmation dialog showing reclaimable disk space estimate
- Option to prune all unused images or only dangling (untagged) images
- Progress feedback during prune operation
- Summary of space reclaimed after prune completes
- Gated by authentication and container actions feature flag

**Effort:** Small

### 6.4 Static Image List Monitoring

Watch images that aren't tied to running containers.

- New watcher provider type: `DD_WATCHER_{name}_PROVIDER=file`
- `DD_WATCHER_{name}_FILE=/config/images.yml` -- YAML list of images to monitor
- Synthetic container representation for downstream compatibility
- Use cases: pre-pull staging images, CI pipeline base images, Dockerfile FROM monitoring, **locally built images without a registry** ([#59](https://github.com/CodesWhat/drydock/issues/59))
- Supports all existing tag filtering, registry auth, and trigger routing
- Local image variant: query Docker image API for other local tags of the same image name, apply semver/tag logic to detect newer local builds

**Effort:** Medium

### 6.5 Image Maturity / Update Age Indicator

**MOVED to Phase 4.6 (v1.5.0)** — see Phase 4.6 for full details.

**Effort:** Small-Medium

### 6.6 Dashboard Customization

Configurable dashboard layout with widget visibility controls and edit-mode drag-and-drop.

**✅ DONE (2026-07-12):** v1.5.0 shipped the initial `grid-layout-plus` implementation; v1.6.0 replaces it with a zero-dependency CSS Grid implementation. The custom grid packs layouts deterministically, supports mouse/touch reorder plus bounded pointer resizing in edit mode, preserves responsive layouts and hidden widgets, and removes `grid-layout-plus` from the UI workspace (#281, #279).

Custom grid requirements:
- CSS Grid–based layout with pointer-event drag (no HTML5 drag API)
- Smooth visual feedback: ghost preview at drop target, insertion-point indicators
- Same-row reorder must work naturally without requiring multi-step workarounds
- Maintain existing features: widget toggle, resize handles, persist to localStorage

Remaining customization features (carry forward):
- "Customize" button in dashboard header opens a slide-in settings panel
- Panel lists all available widgets (stat cards + grid widgets) with toggle switches for show/hide
- Edit mode: entering customization enables visible drop-zone indicators during drag-and-drop (highlight insertion point, ghost preview)
- Outside edit mode, drag-and-drop is disabled (cards are static)
- Default layout: 4 stat cards (Containers, Updates Available, Security Issues, Registries) + 4 widgets (Recent Updates, Security Overview, Host Status, Update Breakdown)
- Additional stat cards available via toggle: Images, Triggers, Watchers
- Additional widgets available via toggle: Recent Activity
- Stat card row auto-adjusts grid columns based on visible card count (e.g. `grid-cols-3` for 3 cards, `grid-cols-5` for 5)
- Persist widget visibility + order to localStorage (versioned key, same `sanitizeWidgetOrder` pattern)
- "Reset to default" button in customize panel restores factory layout
- Research refs: Grafana (explicit edit mode + side panel), Home Assistant (drag grid with visual drop targets), Datadog (edit dashboard overlay), Portainer (zero customization — differentiator for Drydock)

**Effort:** Medium

### 6.7 Keyboard Shortcuts

Global keyboard shortcuts for common UI actions. Inspired by GitHub, Slack, and [Docking Station](https://github.com/LooLzzz/docking-station).

- `/` to focus the search bar from anywhere in the UI
- `Escape` to blur search and close modals/panels
- `?` to show a keyboard shortcut reference overlay
- Composable `useKeyboardShortcuts()` for reusable global listener registration
- Shortcut hints displayed in tooltips where relevant

**Effort:** Trivial

### 6.8 Container Uptime Display

Show how long each container has been running as a human-readable duration.

- Pull `State.StartedAt` from Docker container inspect (already available in watcher data)
- Display relative duration in container list views (table, card, list) and detail panel
- Format: "Up 3 days", "Up 2h 15m", "Up 45s"
- Auto-refresh on a timer or SSE container state change
- Tooltip shows exact start time

**Effort:** Trivial (data already available from Docker API)

### 6.9 PWA Support (Installable Web App)

Progressive Web App support so users can install drydock as a native-feeling app on mobile and desktop. Inspired by [Docking Station](https://github.com/LooLzzz/docking-station) -- the only competitor with PWA support.

- Add `manifest.json` with app name, icons (192px, 512px), theme color, and standalone display mode
- Install `vite-plugin-pwa` for service worker generation and asset caching
- Add install prompt banner (dismissable) when PWA criteria are met
- Offline shell: service worker caches the SPA shell; API calls degrade gracefully when offline
- App icons in multiple sizes for iOS, Android, and desktop
- `<meta>` tags for `apple-mobile-web-app-capable`, `theme-color`, etc.

**Effort:** Small
**Reference:** [Docking Station PWA](https://github.com/LooLzzz/docking-station) uses `@ducanh2912/next-pwa`

### 6.10 Debounced Container Discovery

Harden container discovery against Docker's transient rename aliases during recreation. Instead of registering a new container the moment it appears in `docker container ls`, wait for it to be visible for a configurable settling period (default 30s) before adding it to the store. If the container's name changes during that window (alias → canonical), use the final name. This complements the unconditional hex-prefix stripping shipped in v1.5 (#156) and eliminates the race condition at the source rather than the symptom.

- New containers enter a "pending" state during the settling window
- Pending containers are visible in debug logs but not in the store, triggers, or UI
- Containers that disappear during the settling window are silently discarded
- Configurable via `DD_WATCHER_{name}_DISCOVERY_SETTLE_MS` (default: 30000)
- Existing containers (already in store) are updated immediately — settling only applies to first-seen containers

**Effort:** Small-Medium
**Reference:** [#156](https://github.com/CodesWhat/drydock/issues/156) — Docker recreate alias race condition

### 6.11 Shared AppButton & Action Icon Components

Create shared components to replace inline button patterns that are already drifting across views. The v1.4.5 dashboard QA caught style drift: card-view buttons used `hover:dd-bg-hover hover:scale-110`, list-view used `hover:dd-bg-elevated` (no scale), and the dashboard had a third variant. This kind of drift will worsen as more views add action buttons.

- **`AppButton.vue`** — props: `variant` (ghost/outline/filled/subtle), `size` (xs/sm/md), `icon`, `iconPosition`, `loading`, `disabled`. Replaces the 140+ inline `<button>` elements across 36 files.
- **`AppActionIcon.vue`** — props: `icon`, `size`, `variant` (card/list/compact), `loading`, `disabled`, `tooltip`. Replaces the `w-8 h-8 dd-rounded flex items-center justify-center transition-[...]` pattern used for per-row update/stop/restart/scan buttons. Card variant gets scale, list variant does not.
- Migrate all inline `<button>` elements across the UI to use `AppButton` or `AppActionIcon`
- Standardize icon-text spacing, disabled states, hover effects, and border radius
- Split button variant (Update + dropdown chevron) as a compound `AppSplitButton` component
- Storybook stories for each variant/size/state combination

**Effort:** Medium
**Reference:** v1.4.5 dashboard QA — style drift between card/list/dashboard button patterns

### 6.11 Smart Tag Suggestion for `latest` Containers

**MOVED to Phase 4.9 (v1.5.0)** — see Phase 4.9 for full details.

**Effort:** Small

## Phase 7: Fleet Management & Live Configuration

**Goal:** Better UX for managing many containers across many hosts, and eliminate the "edit env vars + restart" workflow for common configuration changes.
**Timeline target:** v1.8.0

**CI: Re-add ESM readiness check** — `./scripts/esm-readiness.sh --strict` should be added back to CI as a failing step once the ESM migration begins. The script and `--strict` flag already exist; it was removed from CI because it ran as `|| true` (advisory-only) and added no value before the migration.

**Store migration: LokiJS → `better-sqlite3`** — This phase migrates the entire data store from LokiJS (abandoned ~2021) to `better-sqlite3`. YAML config, live config panels, and container groups add relational complexity (cross-references, queries, transactional writes) that justifies the migration cost. All collections (app, audit, backup, container, settings) migrate together. The `better-sqlite3` → `node:sqlite` migration is trivial (near-identical sync API, rename `Database` → `DatabaseSync`) and can happen in a future version if/when `node:sqlite` reaches Stability 2.

**Known issue resolved by this migration — Store write clobbering (P2):** The event-path (`app/triggers/providers/docker/Docker.ts`) and watch-path (`app/watchers/providers/docker/Docker.ts`) both write full container objects via `updateContainer()` in `app/store/container.ts`. Interleaving writes can overwrite newer fields with stale snapshots (e.g., a watch cycle overwrites a trigger's freshly-written `updateAvailable` flag). The fix is field-level `UPDATE` queries instead of full-record replacement, which is natural with SQLite but impractical with LokiJS's document-replacement model.

**Container identity model — ID-based primary key (P2):** Currently containers are identified by a composite of watcher + name, which makes them vulnerable to Docker's transient rename aliases during recreation (e.g. `fcdb966987a0_termix`). v1.5 ships an unconditional hex-prefix strip as a workaround, but the proper fix is making Docker container ID the primary key in the store. Names become display-only, MQTT topics use stable IDs, and recreated containers naturally replace their predecessors by ID. This is a breaking change to MQTT topic structure and the API response format, so it fits the SQLite migration where the schema is already changing. Debounced container discovery (don't register new containers until visible for 30s) can ship as a smaller hardening step in v1.6 or v1.7 without the full ID migration.

### 7.1 YAML Configuration File + Config API (Foundation)

This is the foundation for all UI-writable configuration. Must ship before 7.5.

- Load `drydock.yml` at startup alongside env vars
- Precedence: env vars > config file > defaults (env vars are immutable overrides for Docker Compose deployments)
- Map to existing Joi-validated internal config schema
- Config API: `GET /api/config` (read merged config), `PUT /api/config/{section}` (write to YAML file)
- Hot-reload: file watcher on `drydock.yml` applies changes to triggers, watchers, image lists, and thresholds without container restart
- Sections that require restart (server port, TLS, auth providers) return a "restart required" flag in the API response
- Config file is mounted as a volume (e.g. `-v ./drydock.yml:/config/drydock.yml`)
- Document migration path from env vars to config file

**Effort:** Medium-Large (foundation investment)

### 7.2 Aggregated Multi-Agent Dashboard

Unified view across all agents without requiring source selection.

- Dashboard shows all containers from all agents in one list
- Filter/group by: agent, registry, update status, tag type, custom labels
- Bulk actions: "Update all" with confirmation, "Snooze all patch updates"
- Agent health overview: connected/disconnected/last-seen status bar
- Per-agent "Rescan" button to trigger an immediate container re-watch on a specific agent ([Discussion #188](https://github.com/CodesWhat/drydock/discussions/188))
- Cross-environment resource grouping by custom labels
- ~~Registry digest check deduplication~~ — **MOVED to Phase 4.10 (v1.5.0)**

**Effort:** Medium

### 7.3 Container Groups / Labels

Organize containers into user-defined groups with cross-environment support.

- `dd.group=production` / `dd.group=staging` container labels
- UI: group-based filtering and batch operations
- URL-driven label grouping: `?group-by-label=com.docker.compose.project` or `?group-by-label=dd.group` for shareable bookmark/link support (extends the `?groupByStack=true` param shipped in v1.4.1 — [#145](https://github.com/CodesWhat/drydock/issues/145))
- ~~Expand URL-driven filter/sort state~~ — **MOVED to Phase 4.7 (v1.5.0)**
- Per-group policies and trigger routing
- Cross-environment label grouping (see all `production` containers across all agents)

**Effort:** Medium

### 7.4 Parallel / Concurrent Container Updates

Process updates concurrently instead of sequentially for large fleets.

- `DD_TRIGGER_CONCURRENCY=4` -- max simultaneous trigger executions (default: 1 for backward compat)
- Semaphore/pool pattern around trigger execution
- Per-trigger concurrency override: `DD_TRIGGER_{name}_CONCURRENCY`
- Progress reporting in UI for batch operations

**Effort:** Small

### 7.5 Live UI Configuration Panels

**Depends on:** 7.1 (YAML config + Config API)

Turn the existing read-only Configuration pages into live editors that write back to `drydock.yml`. This is the single biggest UX leap -- adding a Slack webhook becomes "click Add Trigger, fill form, save" instead of "stop container, add env var, restart."

#### UI-configurable (hot-reloadable, no restart needed)

These settings are written to `drydock.yml` via the Config API and take effect immediately:

| Setting | UI Component | Notes |
| --------- | -------------- | ------- |
| Triggers / notifications | Add/edit/delete form (webhook URL, channel, threshold) | Add a Teams or Slack channel without restarting |
| Maintenance windows | Cron schedule picker with visual calendar | Drag to select time windows, timezone dropdown |
| Per-container trigger routing | Checkbox/dropdown in container detail panel | Assign triggers and thresholds per container |
| Per-container update thresholds | Dropdown: all / major / minor / patch | Override from container detail panel |
| Container dependency ordering | Visual tree/graph editor in stack view | Drag to reorder, auto-detect from compose |
| Static image watch list | CRUD table: image, tag filter, registry | Add/remove images to monitor without labels |
| Container display names / icons | Inline edit in container list | Override `dd.display.name` / `dd.display.icon` |
| Watcher poll intervals | Slider or number input | Change poll frequency without restart |

#### Env-var / config-file only (restart required)

These settings are displayed read-only in the UI with a note that changes require a restart:

| Setting | Reason |
| --------- | -------- |
| Docker socket path / remote host connections | Security-sensitive infrastructure |
| Registry credentials (tokens, passwords) | Secrets must not round-trip through browser; use `__FILE` or env vars |
| Auth provider config (OIDC discovery URL, client secret) | Misconfiguration locks you out of the UI itself |
| TLS/HTTPS, server port, bind address | Requires listener restart |
| Agent configuration (remote agent URLs, auth) | Infrastructure-level, changed rarely |
| Concurrency limits | Operational tuning, low-frequency change |

#### Architecture

```text
UI Panel --POST--> /api/config/triggers --> validate (Joi) --> write drydock.yml --> hot-reload triggers
                                                           --> return { success: true, restart: false }

UI Panel --POST--> /api/config/server  --> validate (Joi) --> write drydock.yml --> return { success: true, restart: true }
                                                           --> UI shows "Restart required" banner
```

- All writes go through the same Joi validation used at startup
- Config API is gated by authentication (same as all other API routes)
- Audit log entry for every config change (who changed what, when)
- `drydock.yml` changes are atomic (write temp file, rename) to prevent corruption
- Secrets are never returned in `GET /api/config` responses -- masked or omitted

**Effort:** Large (but high-impact)

### 7.6 Volume Browser

Browse, inspect, and export Docker volume contents from the UI.

- Directory navigation and file listing within volumes
- File download (tar archive) and upload
- File metadata display (size, permissions, modified date)
- Read-only mode when volume is in use by a running container
- Helper container pattern for volume access (auto-cleanup)

**Effort:** Medium

### 7.7 i18n Framework Setup + Crowdin Integration

Set up the internationalization framework, externalize all UI strings, and connect Crowdin for community translation management. Ships with English-only; the goal is to enable community-contributed translations without blocking the roadmap. Dockge already has 15+ languages and Arcane uses Crowdin -- getting the framework in place early lets the community start translating as soon as the infrastructure exists.

**Decision:** vue-i18n + JSON locale files in-repo as source of truth. Crowdin (free for open source) syncs from `ui/src/locales/en.json` and opens PRs with community translations. We do the primary translation work ourselves; Crowdin is for community corrections and contributions. Crowdin was chosen over Weblate/Tolgee because it provides the well-known translation % badge for the README and has the strongest GitHub integration.

**vue-i18n setup:**
- Install and configure `vue-i18n` with composition API integration (`useI18n()`)
- Extract all user-facing strings from Vue components into JSON locale files
- Set up locale file structure (`ui/src/locales/{lang}.json`, `en.json` as source of truth)
- Fallback to English for any untranslated strings (vue-i18n `fallbackLocale`)
- Add language selector to UI settings panel (persisted in user preferences)
- Add CI validation that all locale keys used in source code exist in `en.json`

**Crowdin setup:**
- Register project on Crowdin (free open-source plan)
- Add `crowdin.yml` config pointing at `ui/src/locales/en.json` as source
- Enable GitHub integration (Crowdin syncs source strings on push, opens PRs with translations)
- Add Crowdin translation % badge to README
- Document the dual contribution path: Crowdin web UI (preferred) or fork + PR for locale files

**Initial languages (translated by us):**
- English (source)
- Spanish, French, German (highest demand in self-hosted Docker tooling)

**Effort:** Medium

## Phase 8: Platform Expansion

**Goal:** Extend beyond single-host Docker to Swarm, Kubernetes, and basic Git-based deployment.
**Timeline target:** v2.0.0

### 8.1 Docker Swarm Native Support

Swarm-aware service discovery and update mechanism.

- New watcher provider: `DD_WATCHER_{name}_PROVIDER=swarm`
- Discover Swarm services and their image specs via Docker Swarm API
- Service-level update trigger: `docker service update --image` instead of container recreation
- Support replicated and global service modes
- Detect service labels for `dd.*` configuration (in addition to container labels)
- Multi-node awareness without needing per-node agents

**Effort:** Medium

### 8.2 Kubernetes Watcher Provider

New watcher provider alongside Docker watcher.

- `DD_WATCHER_{name}_PROVIDER=kubernetes`
- `DD_WATCHER_{name}_KUBECONFIG` -- path to kubeconfig (or in-cluster service account)
- `DD_WATCHER_{name}_NAMESPACE` -- namespace filter (default: all)
- Watch Deployments, StatefulSets, DaemonSets, CronJobs for container images
- Use K8s watch API for real-time container changes

### 8.3 Kubernetes Update Triggers

- `DD_TRIGGER_{name}_PROVIDER=kubernetes` -- patch Deployment image field
- Rolling update strategy controls (maxSurge, maxUnavailable)
- Helm upgrade trigger (`DD_TRIGGER_{name}_PROVIDER=helm`)
- Kustomize image override support

**Effort:** High

### 8.4 Basic Git-Based Stack Deployment

Deploy and manage Docker Compose stacks from Git repositories. Moved from Phase 11.1 -- three competitors (Dockhand, Komodo, Arcane) already ship Git-based stack deployment. This ships a focused basic version alongside Swarm/K8s; the full GitOps vision (multi-repo, advanced sync, branch strategies) remains in the long-term backlog.

- Deploy stacks from GitHub, GitLab, Gitea, Forgejo (SSH and HTTPS)
- Webhook trigger for auto-deploy on push to a single tracked branch
- Single repository per stack (multi-repo deferred)
- Compose-only (no Helm/Kustomize -- those are covered by Phase 8.3)
- Encrypted credential storage for Git authentication
- `.env` file detection and application
- Change detection: only redeploy when files in the compose directory change

**Effort:** Medium

## Phase 9: Advanced Deployment Patterns

**Goal:** Enterprise-grade deployment safety.
**Timeline target:** v2.1.0
**Depends on:** Phase 8

### 9.1 Health Check Gate

Post-update health verification before declaring success.

- After update trigger: poll container health endpoint for configurable duration
- `DD_TRIGGER_{name}_HEALTHCHECK_URL` -- endpoint to check post-update
- `DD_TRIGGER_{name}_HEALTHCHECK_TIMEOUT=120` -- seconds to wait for healthy
- On failure: auto-rollback and notify

### 9.2 Canary Deployments (Kubernetes only)

Progressive traffic shifting for Kubernetes workloads.

- `DD_TRIGGER_{name}_STRATEGY=canary`
- `DD_TRIGGER_{name}_CANARY_STEPS=10,25,50,100`
- `DD_TRIGGER_{name}_CANARY_INTERVAL=300`
- Automatic rollback on error-rate spike

### 9.3 Self-Update Controller (Durable Orchestrator)

Replace shell-script self-update transitions with an explicit controller state machine and deterministic gates.

- Controller-first delivery: implement the durable orchestrator directly (no required interim helper-script patch)
- If a critical reliability issue forces interim work, allow a minimal patch only if it preserves the 9.3 contract (opId, explicit states, health-gated commit)
- Introduce operation IDs (`opId`) and durable update journal (resume-safe after process restart)
- Controller state machine with explicit transitions (`PREPARE -> PULL -> CREATE -> STOP_OLD -> START_NEW -> HEALTH_GATE -> COMMIT`)
- Rollback transitions for every failure path (`ROLLBACK_START_OLD`, `CLEANUP_CANDIDATE`, `FAILED_WITH_ROLLBACK`)
- Health-gated commit window (do not remove old container until candidate passes monitor window)
- UI event acknowledgment contract (`dd:self-update-starting` with `opId`, ACK-or-timeout policy, no fixed sleeps)
- Audit and metrics per transition (duration, failure reason, rollback outcome, resumed operation count)

**Effort:** High

### 9.4 Auto-Heal / Self-Healing Orchestration

Proactive health monitoring with automatic corrective actions for unhealthy containers across all connected hosts. Leverages existing container actions (shipped v1.2.0) and the agent architecture for multi-host awareness. Community-requested in [Discussion #198](https://github.com/CodesWhat/drydock/discussions/198).

**Problem:** Docker `restart_policy` triggers on process exit, not health check failure. Containers that become unhealthy while still running require manual intervention. Existing third-party tools (docker-autoheal, docker-surgeon) are unmaintained and single-host only.

**Label-based configuration:**

- `dd.autoheal=true` -- opt-in to auto-heal monitoring
- `dd.autoheal.action=restart` -- corrective action (`restart` default, `stop`)
- `dd.autoheal.delay=30s` -- delay before taking action (prevents boot-loops)
- `dd.autoheal.max_retries=3` -- max consecutive restart attempts before giving up and notifying

**Implementation:**

- Monitoring loop polls container health status via Docker API across all connected watchers (local + remote agents)
- Triggers corrective action when a container with `dd.autoheal=true` enters `unhealthy` state
- Respects delay and max retry limits to prevent restart storms
- Fires existing trigger system (Slack, webhook, email, etc.) on auto-heal events with context: container name, host, action taken, attempt count, success/failure
- Dashboard indicator for auto-heal status (enabled, last action, retry count)
- Audit log entries for all auto-heal actions

**Explicitly out of scope:** Log-based health detection (keyword monitoring in container logs). This is a log aggregation problem best solved by dedicated tools. Drydock monitors Docker health status only.

**Incremental delivery:**

1. Health-status event notifications (new trigger event type) -- could land earlier in v1.6–v1.7
2. Full auto-heal loop (monitor → delay → restart → verify → notify) -- Phase 9, alongside health check gates

**Effort:** Medium

## Phase 10: Container Operations

**Goal:** Full container interaction capabilities -- shell, files, image building, and basic Podman compatibility.
**Timeline target:** v2.2.0

### 10.1 Web Terminal / Container Shell

Interactive shell access to running containers from the UI.

- WebSocket-based terminal emulator (xterm.js)
- Configurable shell selection (bash, sh, zsh, ash)
- User context options for exec sessions
- Keyboard shortcuts support
- Session timeout and idle disconnect
- Gated by authentication and container actions feature flag

**Effort:** Medium

### 10.2 Container File Browser

Browse, upload, and download files from running containers.

- Directory navigation and file listing
- File download (tar archives) and upload
- File metadata display (size, permissions, type)
- Helper container auto-cleanup for stopped containers
- Integrates with container detail panel

**Effort:** Medium

### 10.3 Image Building

Build Docker images from Dockerfiles directly in drydock.

- In-browser Dockerfile editor with syntax highlighting
- Build log streaming (real-time via Docker build API)
- Registry push after successful build
- Build cache management
- Support for build args and multi-stage builds
- Build history with status and logs

**Effort:** Large

### 10.4 Basic Podman Support

Detect and work with Podman's Docker-compatible API. Arcane and Portainer already ship Podman support. This is not full native Podman integration but "works if Podman exposes the Docker-compatible API" -- covering the majority of Podman users who enable the compatibility socket.

- Auto-detect Podman's Docker-compatible API socket (`/run/podman/podman.sock` or `$XDG_RUNTIME_DIR/podman/podman.sock`)
- Validate API compatibility on startup and surface any incompatibilities as warnings
- Test and document the supported Podman feature subset (container CRUD, image pull, stats, logs)
- Document known limitations (rootless Podman networking, volume differences, systemd integration)
- Add Podman to the CI test matrix with basic smoke tests

**Effort:** Small-Medium

## Phase 11: Automation & Developer Experience

**Goal:** First-class API access, automation scripting, and CLI tooling.
**Timeline target:** v2.3.0

### 11.0 Replace Passport.js with Custom Auth Middleware

Passport.js (`passport` 0.7.0, `passport-anonymous` 1.0.1, `passport-http` 0.3.0) is effectively abandoned — last meaningful release was 2023, no active maintenance, and the strategy-based architecture adds unnecessary indirection for Drydock's auth model (basic + OIDC + anonymous). Replace with a lightweight custom auth middleware layer before building Passkey/TOTP/API key features on top.

- Remove `passport`, `passport-anonymous`, `passport-http`, `@types/passport` dependencies
- Replace `BasicStrategy` and `AnonymousStrategy` with direct Express middleware (argon2 verify + session check)
- Replace OIDC passport strategy with direct `openid-client` integration (already used underneath)
- Simplify session serialization (currently Passport-managed `serializeUser`/`deserializeUser`)
- Migrate 15 source files that import passport (`auth.ts`, `auth-strategies.ts`, `Authentication.ts`, `Basic.ts`, `BasicStrategy.ts`, `Anonymous.ts`, `Oidc.ts`, `OidcStrategy.ts`, `session-limit.ts`, `prometheus.ts`, + tests)
- Maintain backward compatibility: same session cookie format, same login/logout API endpoints
- **Prerequisite for:** Passkey (11.1.1), TOTP (11.1.2), API keys (11.1) — building new auth mechanisms on abandoned middleware is wrong

**Effort:** Medium
**Rationale:** Passport's strategy pattern was inherited from WUD upstream. Drydock only uses 3 strategies (basic, OIDC, anonymous) with custom session management already bolted on. Direct middleware is simpler, easier to test, and removes a dead dependency from the supply chain.

### 11.1 API Keys

Scoped, rotatable API keys for automation and third-party integrations.

- Key generation via UI and API
- Scope control: read-only, trigger-only, full access
- Usage tracking and last-used timestamps
- Key rotation without downtime
- Rate limiting per key

**Effort:** Medium
**Demand signal (2026-07-03, #469):** HA/dashboard integrations (wud-card class) want a static bearer token; drydock only ships anonymous/basic/oidc, so the card's `wud_api.auth` field has nothing to map to. A static API-key provider is the integration story every external dashboard consumer asks for — raised priority.

### 11.1.1 Passkey Authentication (WebAuthn)

Modern passwordless authentication using platform authenticators.

- WebAuthn/FIDO2 registration and login flow
- Support for hardware keys (YubiKey), platform biometrics (Touch ID, Windows Hello), and mobile passkeys
- Passkey management UI (register, rename, delete)
- Works alongside existing OIDC and basic auth (additive, not replacement)
- Resident key support for username-less login

**Effort:** Medium

### 11.1.2 TOTP Two-Factor Authentication

Standard time-based one-time password 2FA for local accounts.

- QR code provisioning with authenticator app (Google Authenticator, Authy, 1Password, etc.)
- Recovery codes generated at enrollment
- Enforced or optional per account
- Works with basic auth login flow (password + TOTP code)

**Effort:** Small-Medium

### 11.2 API v2 Hardening & Developer Experience

Elevate the API for external consumers and prepare the v2 contract. The v1 API is solid for self-hosted use (resource-oriented REST, consistent pagination envelope, OpenAPI 3.1 spec, defense-in-depth security); v2 focuses on programmatic ergonomics.

**Already shipped (v1.4.0):**
- OpenAPI 3.1 spec at `GET /api/v1/openapi.json` (16 tags, security schemes, `x-drydock-conventions`)
- Standard pagination envelope `{ data, total, limit, offset, hasMore, _links }`
- `Deprecation`/`Sunset` headers on deprecated endpoints (PUT → PATCH)
- Identity-aware rate limiting with `RateLimit-*` headers
- CSRF, 428 confirmation gate, timing-safe webhook tokens

**v2 additions:**
- **Machine-readable error codes** — add `code` field to error responses (e.g. `{ error: "Unauthorized", code: "AUTH_SESSION_EXPIRED", details?: ... }`) for programmatic consumers. Define an enum of error codes in the OpenAPI spec.
- **API versioning migration guide** — document the `/api/v1` → `/api/v2` transition path, breaking changes policy, and deprecation timeline. Ship as a docs page before v2 lands.
- **Interactive API explorer** — Swagger UI or Scalar at `/api/docs` backed by the existing OpenAPI spec. Read-only in production, full in dev.
- **Cursor-based pagination option** — add `cursor`/`after` parameter alongside existing `offset`/`limit` for endpoints that may grow large (audit log, containers). Offset remains default for backward compat.
- **Webhook event schemas** — publish JSON Schema for each webhook event type so consumers can validate payloads. Include in OpenAPI spec as callback objects.
- **SDK-friendly response types** — ensure all response shapes are named schemas in OpenAPI (not inline) so codegen tools produce clean types.

**Effort:** Medium
**Depends on:** Trigger taxonomy rename (new `/api/actions` and `/api/notifications` endpoints land in v1.5–v1.7)

### 11.3 TypeScript Scripting / Actions

User-defined automation scripts that run inside drydock.

- In-browser TypeScript editor with drydock API bindings
- Scheduled runs (cron expressions)
- Event-driven triggers (on update detected, on container crash, etc.)
- Built-in helpers for common workflows (batch update, conditional notify, etc.)
- Execution log and history
- Sandboxed runtime with resource limits

**Effort:** Large

### 11.4 Drydock CLI

Command-line interface for managing drydock from the terminal.

- Container listing, status, and update checks
- Trigger execution and manual updates
- Configuration management
- CI/CD friendly output (JSON, table, quiet modes)
- Connects to drydock API (local or remote)
- Shell completions (bash, zsh, fish)

**Effort:** Medium

## Phase 12: Data Safety & Templates

**Goal:** Protect user data and simplify application deployment.
**Timeline target:** v2.4.0

### 12.1 Scheduled Automated Backups

Schedule automatic backups of containers, volumes, and configuration.

- Backup targets: local filesystem, Amazon S3, SFTP (SSH), Backblaze B2
- Cron-based scheduling with timezone support
- Backup scope: volumes, container configs, drydock configuration
- Retention policies (keep last N backups, expire after N days)
- Backup status dashboard with history and size tracking
- Restore workflow via UI or CLI
- Pre-backup hooks (stop container, flush DB, etc.)

**Effort:** Medium-Large

### 12.2 Compose Templates Library

Pre-built Docker Compose templates for popular self-hosted applications.

- Built-in app catalog with curated templates
- One-click deployment from template
- Community-contributed templates via Git repository
- Template customization before deployment (env vars, ports, volumes)
- Template versioning and updates
- Compatible with Portainer/Yacht template format for easy migration

**Effort:** Medium

### 12.3 Secret Management

Securely store, manage, and inject secrets into containers.

- Encrypted secret storage (AES-256-GCM at rest)
- Environment variable injection at container start
- Secret rotation with automatic container restart
- Access audit log (who accessed which secret, when)
- File-based secret mounting (Docker secrets pattern)
- Integration with external secret stores (Vault, AWS Secrets Manager) as stretch goal

**Effort:** Large

### 12.4 Multiple Compose File Support

Compose file composition for environment-specific overrides.

- Base compose file + override files (docker-compose.override.yml pattern)
- Environment-specific overrides (dev, staging, production)
- File merging preview in UI before deployment
- Support for `extends` and `include` directives
- Pairs with 7.1 YAML config foundation

**Effort:** Medium

## Phase 13: Advanced Platform

**Goal:** Advanced visualization, hardware monitoring, and full internationalization with community-driven translations.
**Timeline target:** v3.0.0

### 13.1 Network Topology Visualization

Visual map of container relationships, networks, and traffic flow.

- Interactive network graph showing containers, networks, and connections
- Real-time topology updates as containers start/stop
- Network troubleshooting: identify connectivity issues visually
- Filter by stack, network, or label
- Export topology as image or SVG

**Effort:** Large

### 13.2 GPU Monitoring

Monitor NVIDIA and AMD GPU usage for GPU-accelerated containers.

- GPU utilization percentage and VRAM usage
- Temperature monitoring with threshold alerts
- Multi-GPU support (per-device metrics)
- Integration with NVIDIA Container Toolkit / ROCm
- GPU metrics in container detail panel and dashboard

**Effort:** Medium

### 13.3 Multi-Language / i18n (Full Translations)

Full internationalization with broad language coverage. The i18n framework and Crowdin integration ship in v1.8 (Phase 7.7) with English + 3 languages; this phase expands to full coverage and handles layout complexity.

- RTL (right-to-left) layout support (Arabic, Hebrew)
- Expand to remaining high-demand languages: Portuguese, Chinese (Simplified), Japanese, Korean, Italian, Dutch, Russian, Polish, Turkish
- Backend string localization (trigger notification templates, API error messages)
- Translation completeness dashboard in Crowdin (auto-generated)
- Per-language status badges in README (Crowdin provides these)
- Automated CI check: block merges if source `en.json` adds keys without updating Crowdin source
- Community translation review workflow (Crowdin proofreaders + GitHub PR review)

**Effort:** Medium

## Phase 14: Enterprise Access & Compliance

**Goal:** Multi-user access control, directory integration, and compliance audit trail for team and enterprise deployments.
**Timeline target:** v3.1.0

### 14.1 Role-Based Access Control (RBAC)

Multi-user role system with granular permissions.

- Predefined roles: Admin, Operator, Viewer
- Admin: full access (config, users, all actions)
- Operator: container management, trigger execution, view config (no user management)
- Viewer: read-only dashboard and container status
- Custom roles with per-action permission grants (stretch goal)
- Role assignment via UI user management panel

**Effort:** Medium-Large

### 14.2 LDAP / Active Directory

Directory service integration for enterprise identity management.

- LDAP bind authentication (Active Directory, OpenLDAP, FreeIPA)
- Group-to-role mapping (e.g., `cn=drydock-admins` -> Admin role)
- Configurable search base, user filter, group filter
- TLS/STARTTLS support
- Works alongside existing OIDC and local auth (additive)

**Effort:** Medium

### 14.3 Environment-Scoped Permissions

Restrict user access to specific environments or agent groups.

- Assign users/roles to specific agents or environment labels
- Operator on `staging` but Viewer on `production`
- Scoped API access follows same permission model
- Environment groups defined by agent labels or explicit assignment

**Effort:** Medium

### 14.4 Audit Logging (Compliance)

Comprehensive audit trail for all user actions.

- Log all state-changing operations: updates triggered, containers started/stopped, config changes, user login/logout
- Structured log format (JSON) with timestamp, user, action, target, result
- Audit log viewer in UI with search and date filtering
- Log export (CSV, JSON) for compliance reporting
- Configurable retention period
- Optional forward to external log aggregator (syslog, webhook)

**Effort:** Medium

### 14.5 User Management

Local user account administration.

- Create, edit, disable, delete local user accounts
- Password policy enforcement (minimum length, complexity)
- User list with role, last login, status
- Invite flow (email or link-based)
- Self-service password reset

**Effort:** Small-Medium

### 14.6 Hardened Container Image (Wolfi)

Enterprise-grade base image with zero-CVE target and supply chain attestation.

- Custom Wolfi-based image built with apko + melange (Apache 2.0, no licensing cost)
- glibc runtime (better Node.js native module compatibility than Alpine's musl)
- Multi-stage build preserving existing trivy, cosign, SBOM pipeline
- SLSA provenance attestation on release images
- Automated CVE comparison reporting (Alpine vs Wolfi) in CI
- Scheduled base image rebuilds for CVE patching
- Published as `drydock:hardened` tag alongside existing Alpine image
- Alpine image remains default for OSS users

**Effort:** Medium

### 14.7 FIPS 140-2 Compliance Mode

Cryptographic compliance for regulated environments.

- FIPS-validated OpenSSL or BoringSSL for TLS connections
- FIPS mode toggle via environment variable
- Documentation of compliant cipher suites and key sizes
- Applicable to LDAP/TLS, webhook TLS, API TLS

**Effort:** Small-Medium

### 14.8 Runtime Access Policy & Posture Reporting

Central policy controls and audit visibility for Docker API exposure across all environments.

- Policy model for allowed access modes per environment (`proxy-local`, `remote-ssh`, `remote-tls`)
- Policy violations surfaced in UI and API with remediation hints
- Optional integration points for Docker authorization-plugin allowlists
- Compliance report export for insecure runtime exceptions and waiver reasons
- Team-level exception workflow with expiry

**Effort:** Medium-Large

## Phase 15: Drydock Socket Proxy

**Goal:** Ship a purpose-built Docker socket proxy as a companion container, pre-configured with exactly the API endpoints Drydock needs. Eliminates the need for users to configure `tecnativa/docker-socket-proxy` manually and provides a tighter security boundary than generic proxies.
**Timeline target:** v3.2.0
**Depends on:** Phase 14.8 (Runtime Access Policy — defines the policy model this proxy enforces)

### 15.1 Core Socket Proxy

Lightweight reverse proxy (Go or Rust) that sits between Drydock and the Docker socket, filtering requests to only the endpoints Drydock uses.

- Allowlist-based HTTP method + path filtering (deny by default)
- Read-only profile (watcher-only): `GET /containers/json`, `GET /containers/{id}/json`, `GET /images/json`, `GET /images/{id}/json`, `GET /events`, `GET /services/{id}`
- Read-write profile (watcher + triggers): adds `POST /images/create`, `POST /containers/create`, `POST /containers/{id}/start`, `POST /containers/{id}/stop`, `DELETE /containers/{id}`, `DELETE /images/{id}`, `POST /networks/{id}/connect`, `POST /containers/{id}/wait`
- Block dangerous endpoints: `POST /containers/{id}/exec`, `POST /exec/{id}/start`, `GET /containers/{id}/export`, `POST /build`, `POST /swarm/*`
- Profile selection via environment variable (`DD_PROXY_PROFILE=readonly` or `DD_PROXY_PROFILE=readwrite`)
- Health check endpoint (`/_proxy/health`) for Docker Compose `depends_on` condition
- Access logging with request method, path, and allow/deny outcome

**Effort:** Medium

### 15.2 Companion Container & Distribution

Ship the proxy as a multi-arch container image alongside the main Drydock image.

- Published as `codeswhat/drydock-proxy` (or `ghcr.io/codeswhat/drydock-proxy`)
- Multi-arch: `linux/amd64`, `linux/arm64`
- Minimal base image (scratch or distroless) — proxy binary + health check only
- Versioned alongside Drydock releases (same tag scheme)
- Docker Compose snippet in docs and quick start showing Drydock + proxy together
- Automatic profile detection: proxy reads Drydock's trigger configuration to determine read-only vs read-write mode (stretch goal)

**Effort:** Small

### 15.3 Documentation & Migration

Documentation and migration work specific to the future Drydock socket proxy. General rootless Docker, remote TLS, OIDC remote auth, and security posture comparison docs were completed in the docs refresh that folds into v1.6 (the standalone v1.5.2 lane was dropped).

- **Drydock proxy quick start** — add the built-in proxy path alongside the existing `tecnativa/docker-socket-proxy` guidance
- **Built-in proxy policy reference** — document read-only vs read-write profiles, endpoint allowlists, blocked endpoints, and deployment patterns
- **SSH protocol support decision** — document and validate SSH-based remote Docker access if implemented, or remove the stale type if it remains unsupported
- **Migration guide** from `tecnativa/docker-socket-proxy` to `drydock-proxy`

**Effort:** Small-Medium

## Not Planned

| Feature | Reason |
| --------- | -------- |
| Git PR workflow | Renovate's domain; drydock is runtime monitoring, not source-dependency management |
| 90+ package managers | Out of scope for a container-focused product |
| Docker run to compose converter | Dockge's domain; drydock is update monitoring + container management, not compose authoring |
| CI/CD pipelines | Komodo's domain; drydock focuses on runtime management, not build pipelines |
| App store / one-click deploy catalog | CasaOS/Runtipi/Cosmos territory; compose templates (Phase 12.2) covers curated deployments |
| Nomad provider | Low demand; Kubernetes and Swarm cover primary orchestration needs |

## Already Functional (Documentation Needed)

| Feature | Status |
| --------- | -------- |
| Self-update | The Docker trigger can already update drydock's own container. The UI has a self-update overlay with auto-reconnect. Needs documentation and explicit testing to confirm end-to-end reliability. |
