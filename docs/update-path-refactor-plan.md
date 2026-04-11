# Update Path Refactor Plan

Status: draft  
Date: 2026-04-11

## Purpose

Drydock currently has a strong shared runtime update pipeline, but it does not have a single backend-owned admission, queue, and terminalization model for updates.

That gap is the root cause behind the recent stuck-update regression:

- multiple sites assemble terminal records by hand
- multiple initiation surfaces bypass the same admission rules
- queue ordering is implied by in-process execution and UI-supplied metadata instead of a backend queue contract

This document defines the refactor needed to make update execution behave as one coherent system.

## Bottom Line

The external research aligns with the direction Drydock should take:

1. One function must own terminal transitions.
2. Invalid terminal shapes must be unrepresentable in TypeScript.
3. Inner handlers should compute outcomes; an outer wrapper should own final state persistence.

That said, Drydock has a few repo-specific drift points the research does not cover:

1. The authenticated API path already pre-creates queued operations, but webhook and generic trigger execution paths do not.
2. Bulk queue metadata is currently created in the UI, not by the backend.
3. Self-update is a separate execution model and does not currently participate in the normal update-operation store.

Architecture decision:

4. Self-update should use the same persisted operation framework, admission path, queue contract, terminalization rules, and reconciliation logic as every other update, but it should be modeled as its own explicit operation kind rather than pretending to be a normal container recreate.

The refactor must address those repo-specific issues, not just add another terminal helper.

## Current Architecture

### What is already unified

Docker and Docker Compose updates already share the main execution funnel:

- `Docker.trigger()` -> `runContainerUpdateLifecycle()`
- `runContainerUpdateLifecycle()` -> `UpdateLifecycleExecutor.run()`
- `UpdateLifecycleExecutor.run()` owns:
  - context creation
  - security gate
  - lifecycle hooks
  - runtime update dispatch
  - post-update cleanup
  - success/failure event emission

Compose diverges only at the runtime mutation step, which is the correct place to diverge.

### What is not unified

#### 1. Admission is fragmented

The guarded path is `POST /api/containers/:id/update`:

- checks active operations
- checks `updateAvailable`
- rejects rollback containers
- rejects blocked scans
- creates a queued operation row
- passes `operationId` into the trigger runtime
- returns `202 Accepted`

Other paths do not share that contract:

- `POST /api/webhook/update/:containerName`
- generic trigger execution endpoints
- automatic trigger-driven updates from watcher reports
- batched auto-update dispatch via trigger batch execution

Those paths call `trigger.trigger(container)` directly and therefore bypass some or all of the same admission and queue bookkeeping logic.

#### 2. Queue ownership is fragmented

Execution is serialized with a module-level `pLimit(1)` shared by Docker and Compose trigger instances.

That gives Drydock execution serialization, but not a true backend queue abstraction.

Today:

- the UI creates `batchId`, `queuePosition`, and `queueTotal`
- the API accepts and persists those values if present
- the backend does not own batch creation or queue position assignment

As a result, the queue shown to users is partly frontend-authored metadata layered on top of backend serialization.

#### 3. Terminal writes were historically fragmented

Before the recent helper work, several failure branches each wrote their own terminal record shape and each forgot different fields.

This is the exact class of bug the refactor must eliminate structurally.

#### 4. Self-update is a separate model

Self-update branches away from normal container update execution before `ContainerUpdateExecutor` and uses helper-container coordination plus SSE acknowledgements.

That path carries an operation id for self-update coordination, but it does not currently use the normal update-operation persistence model.

This means Drydock does not yet have one canonical update-operation model across:

- normal Docker updates
- Compose-managed updates
- self-updates

## Target Invariants

These invariants should hold after the refactor:

1. Every update request enters through one backend admission function.
2. Every accepted update gets one backend-owned operation record.
3. Every queued update gets its queue position from the backend, never from the UI.
4. Every terminal transition goes through one helper.
5. No code outside that helper constructs a terminal operation shape.
6. Every execution path routes through one outer wrapper that owns success/failure finalization.
7. Stale active operations are reconciled on startup and after long-running process gaps.
8. Self-update uses the same persisted operation framework and queue semantics as all other updates, but is modeled as an explicit `self-update` operation kind.

## Proposed Architecture

### 1. Introduce a backend admission/enqueue service

Create a dedicated backend module, for example:

- `app/updates/request-update.ts`
- or `app/updates/UpdateRequestService.ts`

It should own:

- trigger resolution
- container eligibility validation
- duplicate-active rejection
- security-gate prechecks that belong to admission
- operation creation
- queue insertion
- audit intent metadata
- returning the accepted operation id

All of these callers should use it:

- `POST /api/containers/:id/update`
- webhook update endpoint
- generic trigger execution endpoints when they are being used for container updates
- auto-triggered updates from watcher report handling
- subscription-based auto-update dispatch in `Trigger.ts`
- batched auto-update dispatch that currently fans out through `triggerBatch(...)`

No caller should invoke `trigger.trigger(container)` directly for a container update unless it is inside the queue worker/executor owned by this service.

### 2. Introduce a backend-owned queue service

Create a single queue abstraction for update operations, for example:

- `app/updates/queue.ts`
- or `app/updates/UpdateQueueService.ts`

Responsibilities:

- assign queue order
- assign `batchId` / `queuePosition` / `queueTotal` when batching is needed
- own dequeue/start behavior
- hand accepted operations to the existing shared lifecycle runner

This queue may still use an in-process implementation initially. The first required milestone is narrower than a full standalone worker: the backend must become the sole source of queue metadata even if dequeue/start is still driven by the existing shared `pLimit(1)` execution serializer. Replacing `pLimit(1)` with a dedicated dequeue service is later work for features like priority, preemption, or restart persistence.

The UI should stop sending:

- `batchId`
- `queuePosition`
- `queueTotal`

Instead, the backend should expose:

- single-item enqueue
- optional bulk enqueue

### 3. Keep one execution funnel

Do not replace `UpdateLifecycleExecutor`.

Use it as the execution core:

- admission service accepts requests
- queue service schedules work
- queue worker invokes the shared lifecycle executor

Compose should continue to override only runtime mutation.

### 4. Centralize terminalization

Keep one terminal helper, for example:

- `markOperationTerminal(id, outcome)`

It must be the only place that:

- sets terminal status
- sets terminal phase
- writes `completedAt`
- clears queue-only metadata
- writes final error/result fields

No other code should assemble terminal patches ad hoc.

### 5. Make invalid states unrepresentable

Move the update-operation model toward a discriminated union.

Example direction:

```ts
type QueuedOperation = {
  status: 'queued';
  phase: 'queued';
  createdAt: string;
  queuePosition?: number;
  queueTotal?: number;
};

type InProgressOperation = {
  status: 'in-progress';
  phase: InProgressPhase;
  createdAt: string;
  startedAt?: string;
};

type SucceededOperation = {
  status: 'succeeded';
  phase: TerminalSuccessPhase;
  createdAt: string;
  completedAt: string;
};

type FailedOperation = {
  status: 'failed';
  phase: TerminalFailurePhase;
  createdAt: string;
  completedAt: string;
  lastError: string;
};
```

Important rule:

- terminal variants do not carry queue-only fields

Also require exhaustiveness at call sites with `assertNever()` in status switches.

### 6. Add outer-wrapper finalization

The queue worker or lifecycle wrapper should own the success/failure terminal transition.

Inner execution stages should:

- update progress
- throw on failure

Outer execution should:

- catch
- call `markOperationTerminal(...)`
- emit final events

This removes terminal ownership from inner catch blocks and makes the invariant structural.

### 7. Add startup reconciliation

Add a startup sweep for stale active operations:

- `queued` too old without execution start
- `in-progress` too old without completion

That sweep should route through the same terminal helper and record a clear recovery reason.

### 8. Integrate self-update as an explicit operation kind

Decision:

- self-update joins the same persisted update-operation framework
- self-update uses the same backend admission path
- self-update uses the same backend-owned queue
- self-update uses the same terminal helper and startup reconciliation
- self-update is represented with an explicit operation kind such as `kind: 'self-update'`

Rationale:

- self-update is not the same runtime action as a normal container update because it uses helper-container handoff and process replacement semantics
- self-update still needs the same guarantees as every other update: durable operation identity, queue ownership, terminalization, and stale-operation recovery
- keeping self-update as a separate side channel guarantees more drift
- forcing self-update to masquerade as a plain container update hides important differences in phases, UX, and recovery behavior

Concrete implications:

- the persisted operation record should have a shared top-level shape with a `kind` discriminator
- self-update should receive its operation id from persisted operation creation, not from ad hoc SSE-only id generation
- the helper-container flow should report progress against that persisted operation id
- the UI should branch on `operation.kind` for self-update-specific messaging, not on out-of-band event heuristics
- queue policy remains centralized even if self-update later gets special priority or exclusivity rules

## Recommended Phases

### Phase 1: Normalize state ownership

Goal:
Eliminate the current bug class and align all update initiators behind shared admission logic.

Scope:

- finalize `markOperationTerminal(...)` as the only terminal writer
- introduce/update discriminated union types for update operations
- add `assertNever()` exhaustiveness on `status` handling
- extract shared backend admission/enqueue function
- route manual API, webhook, and update-trigger API entrypoints through that admission function

Expected outcome:

- no path can create a terminal record with missing terminal fields
- no manual/update endpoint bypasses operation creation

### Phase 2: Move queue ownership to the backend

Goal:
Make queue state authoritative and backend-owned.

Scope:

- make backend admission the sole source of queue metadata assignment
- stop accepting UI-authored queue metadata
- add bulk enqueue support on the backend
- move dashboard and grouped update-all flows to bulk enqueue or repeated single-item enqueue through the backend
- keep the existing `pLimit(1)` execution serializer for dequeue/start behavior in this phase

Note:

- Phase 2 does not require replacing `pLimit(1)` with a dedicated dequeue service
- a separate queue runner remains valid future work if Drydock needs priority, preemption, or durable queue recovery

Expected outcome:

- batch sequencing is consistent across all UIs and all initiators
- queue labels come from persisted backend state, not frontend-generated hints

### Phase 3: Wrap execution and reconcile crashes

Goal:
Guarantee finalization for all thrown execution failures and recover stale operations after process interruptions.

Scope:

- add outer execution wrapper that owns terminalization
- reduce inner handlers to progress writes + throws
- add startup reconciliation sweep
- add stale active-operation metrics/logging

Expected outcome:

- handler errors cannot strand operations in active states
- process restarts do not leave old active rows hanging indefinitely

### Phase 4: Integrate self-update into the shared operation system

Goal:
Bring self-update into the same operation and queue framework without erasing its distinct runtime semantics.

Scope:

- add explicit `kind` support to the persisted operation model
- create persisted self-update operations before starting helper-container handoff
- route self-update through the same backend admission and queue path
- report self-update progress and terminal state through the shared operation contract
- align UI rendering rules on `operation.kind`

Expected outcome:

- self-update is no longer a hidden special case
- self-update no longer relies on SSE-only operation ids
- self-update participates in the same queue, finalization, and recovery guarantees as other updates

## Acceptance Criteria

The refactor is complete when all of the following are true:

1. No endpoint performing a container update calls `trigger.trigger(container)` directly outside the shared admission/queue path.
2. No UI surface sends queue metadata to the backend.
3. No code outside the terminal helper writes a terminal update-operation shape.
4. `switch (operation.status)` sites are exhaustive.
5. A thrown runtime error always leads to a terminal persisted operation.
6. Startup reconciliation converts stale active rows into explicit terminal rows.
7. Compose-managed updates still use the shared lifecycle executor.
8. Self-update has an explicit persisted state contract within the shared operation framework.

## Non-Goals

These are not required for this refactor:

- adopting Temporal
- adopting Restate
- adopting DBOS
- adopting XState
- writing a custom FSM framework

Those tools solve different problems than the one Drydock currently has.

## Suggested Work Breakdown

Recommended implementation order:

1. Land the shared admission service and route webhook/manual callers through it.
2. Finish the discriminated union and terminal helper cleanup.
3. Add the backend queue abstraction.
4. Move UI bulk flows to backend-owned batch enqueue.
5. Add outer-wrapper finalization and startup reconciliation.
6. Add `kind` support and integrate self-update into the shared operation framework.

## Notes

This is a meaningful refactor, but it should not be done as a big-bang rewrite.

The system already has a good execution core. The refactor should preserve that core and remove the drift around it:

- admission drift
- queue ownership drift
- terminal-write drift
- self-update modeling drift
