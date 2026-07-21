# Drydock — Current Tracker

Last updated: 2026-07-12

**This is the operational source of truth for what happens next.**

- Long-range strategy and feature detail: [`../ROADMAP.md`](../ROADMAP.md)
- Completed history: [`archive.md`](archive.md)
- Public summaries: `README.md` and `apps/web`

When implementation, release, or live GitHub state changes, update this file in the same pass. “Implemented locally,” “landed on a branch,” and “shipped in a release” are different states.

---

## Release and branch state

- **Latest GA:** `v1.5.1`, released 2026-07-09.
- **Patch candidate:** `v1.5.2-rc.4`, released 2026-07-12. It includes the #496 maturity-retention fix and the #498 pinned-tag detection/visibility work; the matching v1.6 UI forward-port still needs reconciliation.
- **v1.6 branch:** local `dev/v1.6` contains the unpushed v1.6 stack through the final #325 review fixes (`3abdfa0c`); `origin/dev/v1.6` remains at `87baa455`. Use `git status` for the live ahead/behind count rather than copying a self-invalidating local HEAD here.
- **Verification:** backend 11,689 tests and UI 4,136 tests at 100% coverage; backend/UI lint, typecheck/build, and website build (262 pages) pass. The `v1.6.0` release precheck correctly blocks on the four still-open unchecked Discussion follow-ups below instead of passing vacuously.
- **GitHub metadata:** this repository has no GitHub milestones configured. “v1.6” assignments are release promises and tracker state, not GitHub milestone membership.

## v1.6 implemented and verified locally

These are code-complete on the local `dev/v1.6` branch but are not released yet:

- Notification templates, representative preview, and provider fallback (`512d7cc1`, `cf2c0066`).
- Audit-backed notification-bell preferences and cross-device preference sync ([#220](https://github.com/CodesWhat/drydock/discussions/220), `4390aef0`, `512d7cc1`, `518851ec`).
- Zero-dependency custom dashboard grid ([#281](https://github.com/CodesWhat/drydock/issues/281), `e59f1747`).
- Responsive table/card list views, column-readability fixes, and the mobile/touch-target pass ([#242](https://github.com/CodesWhat/drydock/discussions/242), [#473](https://github.com/CodesWhat/drydock/discussions/473)).
- Bidirectional Home Assistant MQTT ([#210](https://github.com/CodesWhat/drydock/discussions/210), `5183e6cb`, `87baa455`).
- Declarative update-policy precedence, source metadata, override/revert UI, and audit ([#320](https://github.com/CodesWhat/drydock/issues/320), [#307](https://github.com/CodesWhat/drydock/discussions/307), `25c99055`, `1ad12dfb`, `0c3c99d9`).
- Maturity stabilization countdown and override ([#406](https://github.com/CodesWhat/drydock/discussions/406), `fe6c4a4f`).
- Pinned-tag policy inheritance and informational insight backend ([#498](https://github.com/CodesWhat/drydock/issues/498)); see the remaining UI item below.
- Health-status notification delivery and audit ([#198](https://github.com/CodesWhat/drydock/discussions/198), `7abd671f`); full auto-heal remains v2.1.
- Trigger-taxonomy Phase 3 error-level migration signals (`3211666e`).
- Bucket C named work: registry tag-list dedupe, lightweight aggregate reads, virtualized log viewer with immutable rollover, auth-bootstrap timeout, sequential preference migration, stale-chunk self-heal, and CI nits (`792a3ebc` through `b38a8f6b`, plus `518851ec`).
- v1.6 compatibility removals and lifecycle signals (`283437b3` through `883cd594`).
- #491 Home Assistant template fix, #494 category-scoped labels, and #496 forward-port.
- #490 Trivy long-scan correctness: 600s default, 30s Node grace with honest timeout errors, one transient gate retry, block-only pruning, serialized local DB warm-up, and server-mode guidance.
- #325 Update Status panel and global update mode: actionable conditions in both detail surfaces; server-wide `notify | manual | auto` enforcement; fresh-install `manual` default with existing installs migrated to `auto` for compatibility.

## v1.6 release gates — do next

1. **[#498](https://github.com/CodesWhat/drydock/issues/498) stacked current→newer Tag-column UI — partial.** Backend insight and inheritance are present. The requested at-a-glance UI and rc.4 polish exist only on `origin/feat/v1.6-pin-insight-view`; rebase/cherry-pick deliberately onto current `dev/v1.6`, rerun full UI gates, and keep the issue open for the reported `v3.0.2 Major` anomaly.
2. **[#321](https://github.com/CodesWhat/drydock/discussions/321) remaining slices — decision required.** SBOM off-heap storage, collection byte attribution/audit dedupe, dry-run UX, typed preview errors, relative-severity gating, and the rolling-RC-tag decision are not implemented. Explicitly re-lane any item not shipping in v1.6; do not lose them behind the already-fixed original bugs.
3. **[#295](https://github.com/CodesWhat/drydock/discussions/295) cross-view link/action consistency — partial.** Source/release/registry links already work; the remaining v1.6 promise is consistent icon placement and touch-friendly behavior across card, list, table, and detail surfaces. Finish that design pass or publish a clear re-lane; do not describe the underlying link capability as new.
4. **Health/bell integration hardening — partial.** The later UI pass added `container-unhealthy` to bell rules and refreshes the bell on agent-status SSE. The backend audit dedupe is still keyed only by container name; scope it by agent + watcher + container and add a same-name/different-agent regression test. Verify the existing agent-status event covers health-only transitions; add a dedicated post-audit invalidation only if that verification fails.
5. **Release convergence.** Resolve the gates above, push the local commit stack, run the full release cut verification, and perform the GitHub follow-ups below.

Scanner runtime decoupling, Grype, scanner asset lifecycle, and SBOM off-heap storage are not completed v1.6 scope. If they do not land before GA, move them to an explicit later lane in both the roadmap and public summaries.

## GitHub follow-up map

### Discussions promised a v1.6 delivery

| # | Topic | Local status | Live state | GA action |
| --- | --- | --- | --- | --- |
| #198 | [Health notifications](https://github.com/CodesWhat/drydock/discussions/198) | Promised health-event slice implemented; full auto-heal remains v2.1 | OPEN | ☐ Post the “shipped in v1.6.0” follow-up, then close per policy |
| #220 | [Preference sync](https://github.com/CodesWhat/drydock/discussions/220) | Implemented locally | OPEN | ☐ Post the “shipped in v1.6.0” follow-up, then close per policy |
| #242 | [Mobile-friendly views](https://github.com/CodesWhat/drydock/discussions/242) | Promised slice implemented locally | OPEN | ☐ Post the “shipped in v1.6.0” follow-up, then close per policy |
| #325 | [Update Status and global update mode](https://github.com/CodesWhat/drydock/discussions/325) | Implemented locally, including review hardening | CLOSED / ANSWERED | ☐ Post the “shipped in v1.6.0” follow-up; no close action needed |
| #406 | [Stabilization/countdown](https://github.com/CodesWhat/drydock/discussions/406) | Implemented locally | OPEN | ☐ Post the “shipped in v1.6.0” follow-up, then close per policy |

### Issues and PRs pending release convergence

| Item | Status | Next action |
| --- | --- | --- |
| [#490](https://github.com/CodesWhat/drydock/issues/490) | Fix package implemented and verified locally | Reply/close when released |
| [#491](https://github.com/CodesWhat/drydock/issues/491) | Core template/root-cause fixes implemented locally | Replace the stale debug-output hold with “fixed on v1.6”; close/reply at release if no secondary repro remains |
| [#494](https://github.com/CodesWhat/drydock/issues/494) | Fix implemented locally (`cd8c11e6`, `f1f040b0`) | Reply/close when released |
| [#498](https://github.com/CodesWhat/drydock/issues/498) | Partial; backend/policy work landed locally, stacked UI not on current HEAD | Reconcile feature branch, investigate anomaly, keep open |
| [PR #486](https://github.com/CodesWhat/drydock/pull/486) | Current workflow-comment drift fixed locally by `b38a8f6b` | Allow default-branch convergence to close/supersede PR; version-agnostic wording is optional hardening |
| [PR #489](https://github.com/CodesWhat/drydock/pull/489) | Dead `@types/node-cron` removed locally by `b38a8f6b` | Allow default-branch convergence to close/supersede PR |

### Release follow-ups for resolved threads

Post accurate release follow-ups for #210, #307, #469, and #473. #185 scheduled digest, #209 Tag/Version split, #299 Security-page update action, #300 security digest, and #329 i18n shipped in earlier releases and belong in archive/history, not active v1.6 work.

## Correctly deferred

- [#219](https://github.com/CodesWhat/drydock/discussions/219) dependency ordering and [#232](https://github.com/CodesWhat/drydock/discussions/232) multi-select update remain v1.7.
- Full [#198](https://github.com/CodesWhat/drydock/discussions/198) auto-heal remains v2.1; v1.6 only delivers health-event notification.
- First-party Home Assistant card remains optional backlog; v1.6 delivers the opt-in wud-card/Homepage compatibility shim.
- Ntfy enhancements remain backlog.

## Tracker hygiene

- Use `fixed-pending-release` for code-complete issue work that is not tagged yet.
- Do not say “shipped on `dev/v1.6`.” Use “implemented locally,” then “landed,” then “shipped” only after the corresponding release tag exists.
- One maintainer reply per thread when there is an accurate version answer. For open promised Discussions, reply at release and close per policy; reopen on verified pushback.
