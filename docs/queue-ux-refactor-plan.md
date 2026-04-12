# Queue UX Refactor Plan

> Status: planning
> Created: 2026-04-11
> Branch: feature/v1.5-rc8
> Research: `.research-findings.md`

## Goal

Drop the per-card "N of M" label in favor of phase-only status (`Queued` / `Updating` / `Done`). Move the N-of-M to the group header so it represents batch progress (`Updating stack · 2 of 5 done`). Eliminate the ephemeral Vue ref that shadows backend state so the same container shows the same status in every view without client-side reconciliation.

This matches the 2026 UX consensus from NNG, LogRocket, Polaris, Carbon, Vercel, GitHub Actions, and every other modern PaaS/container dashboard. Per-card N-of-M is a non-standard pattern that falls apart when multiple batches run concurrently — which is exactly the confusion hit during QA.

## Non-Goals

- Adding estimated wait time / ETA (requires new instrumentation to track average update duration — punt to a later plan).
- Global cross-batch queue position (blocked by backend — `createdAt` not serialized, no `globalPosition` field — punt).
- Any backend schema change. All changes stay in the UI layer and reuse existing `updateOperation` fields.

## Target State

### Per-container card (everywhere: list, table, cards, side panel, full page, dashboard widget)

```
[spinner]  Updating
[clock]    Queued
[check]    Updated
[x]        Failed
```

Single phase label. No denominator. No ordinal position. Same string regardless of view, grouping mode, or which batch the container belongs to.

### Group header (`Update all` button area in grouped views)

**Idle:** `[cloud-download] Update all`
**Batch running:** `[spinner] Updating stack · 2 of 5 done` — button itself disabled, not clickable
**Batch done:** returns to idle `Update all` (or shows a transient "All up to date" if nothing left to update)

`2 of 5` = doneCount / frozenTotal, where:
- `frozenTotal` is captured at the moment the user clicks "Update all" — specifically set to `response.accepted.length` so it reflects what the backend actually queued (not what the user requested, which may include rejected items).
- Stored in a **module-scope composable at `ui/src/composables/useUpdateBatches.ts`**, keyed by **`groupKey`** (not `batchId` — see below). Drydock doesn't use Pinia; the existing pattern is module-scope singleton refs in composables (see `ui/src/composables/useToast.ts:14-15`).
- `doneCount` = `frozenTotal − (containers in group whose updateOperation is still queued/in-progress)`.
- Only renders when `frozenTotal >= 2`. Single-container groups keep the existing `[spinner] Update all` disabled state with no counter text. This matches backend behavior: `request-update.ts:253` skips `batchId` when `queueTotal <= 1`, so there is no batch to track.

**Why keyed by `groupKey` and not `batchId`:** the `/api/v1/containers/update` response (`app/api/container-actions.ts:311-315`) only returns `containerId/containerName/operationId` per accepted item — no `batchId`. We'd have to wait for the next SSE-triggered list reload to learn the batchId and then associate it back to the click. Keying by `groupKey` avoids the round-trip entirely, and the user can only have one active batch per group at a time anyway (the button is disabled while any container in the group is in-flight), so there's no ambiguity. Clear the entry when `containers in group with updateOperation.batchId !== undefined && status ∈ {queued, in-progress}` reaches zero.

Using `frozenTotal` instead of live `queueTotal` is mandatory because `markOperationTerminal` in `app/store/update-operation.ts:614-622` wipes `batchId`/`queuePosition`/`queueTotal` on terminal transitions — by the time a batch finishes, the backend has nothing left to read for the total.

### State source of truth

`container.updateOperation` from the backend, delivered via SSE `dd:update-operation-changed` events that trigger a full list reload. **No local ephemeral refs override it.** The current `groupUpdateSequence` / `groupUpdateQueue` / `groupUpdateInProgress` Vue refs in `useContainerActions.ts` are removed from the label computation path entirely.

## Phases

### Phase 1 — UI refactor: kill per-card N-of-M

**Intent:** Stop rendering `N of M` on individual containers. Phase label only.

- [ ] `ui/src/views/containers/useContainerActions.ts:1262-1273` — rewrite `getContainerUpdateSequenceLabel` so it returns only `'Updating' | 'Queued' | null` (or simply delete it and compute from `container.updateOperation.status` inline). Drop the `groupUpdateSequence.value.get(target.id) ?? getPersistedTargetSequence(...)` merge — it's dead weight once N-of-M is gone.
- [ ] `ui/src/components/containers/ContainerSideDetail.vue:47-53` — `formatUpdateStateLabel` simplified to return `'Updating'` or `'Queued'` with no sequence suffix.
- [ ] `ui/src/components/containers/ContainerFullPageDetail.vue:48-54` — same simplification.
- [ ] `ui/src/components/containers/ContainersGroupedViews.vue:139-145` — same simplification.
- [ ] `ui/src/views/dashboard/components/DashboardRecentUpdatesWidget.vue:42-185` — rip out the independent batch-head tracking copy (`getBackendRowSequence`, `backendUpdateSequenceHeadByBatch`, `getRowUpdateLabel`). Replace with direct `container.updateOperation.status → phase label` read. No more parallel implementation.

**Acceptance:**
- No string in the UI of the form `\d+ of \d+` sourced from a container update operation.
- Grep for `queuePosition` / `queueTotal` in `ui/src/` returns zero results outside of type definitions and the new group-header derivation (Phase 2).
- Containers page, dashboard widget, and side/full-page detail panels all render the same status string for the same container at the same instant.

### Phase 2 — Group header batch progress

**Intent:** Add `Updating stack · 2 of 5 done` to the `Update all` button area, frozen at click time, durable across navigation.

- [ ] New composable `ui/src/composables/useUpdateBatches.ts` following the module-scope singleton pattern from `useToast.ts:14-15`. Exports: `captureBatch(groupKey: string, frozenTotal: number)`, `clearBatch(groupKey: string)`, `getBatch(groupKey: string): { frozenTotal: number; startedAt: number } | undefined`, and a reactive `batches` ref for components that want to subscribe. Internally: `const batches = ref(new Map<string, FrozenBatch>())` at module top.
- [ ] `ui/src/views/containers/useContainerActions.ts:433` — `updateAllInGroupState` calls `captureBatch(group.key, response.accepted.length)` immediately after the API call resolves, using the **actually-accepted count** (not the requested count) so the total reflects what the backend queued. Only call when `response.accepted.length >= 2`.
- [ ] `ui/src/components/containers/ContainersGroupHeader.vue:7-20` — add new props: `frozenTotal?: number`, `doneCount?: number`. When both present and `frozenTotal >= 2` and doneCount < frozenTotal, render `Updating stack · ${doneCount} of ${frozenTotal} done` and keep the button disabled. Otherwise render the idle `Update all` state. Single-container groups keep the existing `[spinner] Update all` behavior (no counter text).
- [ ] `ui/src/components/containers/ContainersGroupedViews.vue:251` — derive the two props from `getBatch(group.key)` plus the live container list (for `doneCount`, computed as `frozenTotal − count(containers in group whose updateOperation?.status ∈ {queued, in-progress})`). Thread them into `ContainersGroupHeader`.
- [ ] `useUpdateBatches.ts` needs an auto-clear hook: when the derived `doneCount` reaches `frozenTotal` (i.e., no containers in the group still have an active operation), call `clearBatch(groupKey)` so the header returns to idle. Can be done in `ContainersGroupedViews.vue` via a `watch` on the derived doneCount.
- [ ] Purge ephemeral refs: delete `groupUpdateInProgress`, `groupUpdateQueue`, `groupUpdateSequence` from `useContainerActions.ts:1111-1113` and all their callsites. Anything that needed them reads from `useUpdateBatches` or from `container.updateOperation` instead.

**Acceptance:**
- Click "Update all" on a stack with 3 containers → header immediately shows `Updating stack · 0 of 3 done`, button disabled.
- As each container completes → `1 of 3`, `2 of 3`, `3 of 3`.
- Navigate away mid-batch, come back → header still shows correct progress (Pinia store survived).
- Batch completes → header returns to idle `Update all`.
- Fire two stacks' batches concurrently → each stack header shows its own independent frozen total; individual containers still show only phase labels with no cross-contamination.

### Phase 3 — Tests

**Intent:** Lock in the new behavior so it doesn't regress like the DetailPanel margin did.

- [ ] `ui/tests/views/containers/useContainerActions.spec.ts` — rewrite the N-of-M assertions. New assertions: phase label derivation returns only status strings; no position/total arithmetic.
- [ ] `ui/tests/views/DashboardView.spec.ts` + new `DashboardRecentUpdatesWidget.spec.ts` — assert the widget renders phase labels only and reads from `container.updateOperation.status` directly.
- [ ] New `ui/tests/components/ContainersGroupHeader.spec.ts` — mount with mock batch props, assert:
  - Idle state: `Update all` visible, button enabled.
  - Single-container case (`frozenTotal === 1` or absent): `[spinner] Update all` disabled during inProgress, no counter text.
  - Active multi-container batch: `Updating stack · X of Y done` visible, button disabled, count updates reactively as doneCount prop changes.
  - Batch cleared: returns to idle.
- [ ] New `ui/tests/composables/useUpdateBatches.spec.ts` — assert frozen total is captured at admission, survives cross-component reads, and is cleared via `clearBatch`. Also assert module-scope singleton behavior (two imports see the same Map).
- [ ] Update the existing `Trigger.test.ts` / `request-update.test.ts` backend tests — they should still pass unchanged since no backend change.
- [ ] LOCKED comment pattern (same as `DetailPanel.spec.ts`): add a `DO NOT REGRESS` block to the group header spec explaining that per-card N-of-M is a 2026 anti-pattern and linking to `.research-findings.md`.

**Acceptance:**
- `npm run test:unit` in `ui/` passes with 100% coverage maintained.
- Coverage gap report (`.coverage-gaps.json`) is empty after the refactor.

### Phase 4 — QA + docs

- [ ] Rebuild `drydock:dev` image, tear down + bring up QA stack.
- [ ] Manual QA: fire concurrent "Update all" on `infra` (3 containers) + `remote` (2 containers), confirm:
  - Each stack header shows its own `X of Y done` independently.
  - No `N of M` appears on any individual container card in any view (list, table, cards, side detail, full page, dashboard widget).
  - Navigating between Containers / Dashboard / side panel shows consistent status for each container.
- [ ] Navigate away mid-batch → come back → status preserved.
- [ ] Update `docs/update-path-refactor-plan.md` to reference this document for the Phase 5 UI work.
- [ ] Add a short `CHANGELOG.md` entry under rc.8: `♻️ refactor(ui): phase-label update status, batch progress on group header`.

## Resolved Questions

1. **FIFO within a batch?** **Yes — strictly FIFO.** `request-update.ts:274-276` runs accepted updates with a `for await (const entry of accepted)` loop. Each container starts only after the previous one resolves, and `queuePosition` is assigned 1-indexed in input array order, so execution order matches `queuePosition` exactly. No reorder is possible without rewriting the execution loop. This means `N ahead of you` on a card would be safe to show — punted to a follow-up enhancement anyway (see Out of Scope).
2. **State store pattern.** **Module-scope composable, not Pinia.** Drydock does not use Pinia (grep confirms). The existing pattern is module-scope singleton refs in composable files — see `ui/src/composables/useToast.ts:14-15`. New composable lives at `ui/src/composables/useUpdateBatches.ts`.
3. **Single-container "Update all" button?** **Keep existing behavior.** 1-container groups render `[spinner] Update all` (disabled) with no counter text. Justification: backend `request-update.ts:253` only creates a `batchId` when `queueTotal > 1`, so there is no batch to track for single-container updates. The new `Updating stack · X of Y done` text only renders when `frozenTotal >= 2`.

## Out of Scope / Follow-ups

- **`N ahead of you` on individual cards** — FIFO is guaranteed within a batch (see Resolved Questions), so this is safe to add as a follow-up enhancement. Punted for simplicity in this refactor.
- **ETA on queued containers** — needs average-duration instrumentation.
- **Global cross-batch counter** — needs backend `createdAt` serialization or new `globalPosition` field.
- **SSE "last updated" heartbeat / stale stream indicator** — NNG flagged as medium severity but separate concern.
- **Containers table bottom-padding gap** — unrelated layout bug from earlier session, track separately.

## Files Touched (summary)

**Deleted / heavily refactored:**
- `ui/src/views/containers/useContainerActions.ts` — `getContainerUpdateSequenceLabel`, ephemeral refs.
- `ui/src/views/dashboard/components/DashboardRecentUpdatesWidget.vue` — batch-head tracking copy.

**Modified:**
- `ui/src/components/containers/ContainerSideDetail.vue`
- `ui/src/components/containers/ContainerFullPageDetail.vue`
- `ui/src/components/containers/ContainersGroupedViews.vue`
- `ui/src/components/containers/ContainersGroupHeader.vue`

**New:**
- `ui/src/composables/useUpdateBatches.ts` — module-scope frozen-total tracking (pattern per `useToast.ts`).
- `ui/tests/components/ContainersGroupHeader.spec.ts`
- `ui/tests/composables/useUpdateBatches.spec.ts`
- `ui/tests/components/DashboardRecentUpdatesWidget.spec.ts` (if it doesn't already exist)
