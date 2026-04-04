# Persistent Implementer Workstreams Design

**Date:** 2026-04-04
**Status:** Draft for review
**Scope:** `extensions/subagent/`, shared session persistence, workflow UI/status, and related tests

## Goal

Add persistent in-process implementer sessions to `pi-superpowers-plus` so the orchestrator can reuse useful implementation context across follow-up rounds within the same task, while keeping reviewers fresh and independent.

The design should improve iteration speed on code fixes, follow-up requests, and review response loops without changing the package's core workflow model or weakening review quality.

## Problem Statement

The current `subagent` extension is optimized for isolation, not continuity:

- every invocation spawns a fresh `pi` subprocess
- the current spawn path uses `--no-session`
- skills such as `subagent-driven-development` explicitly assume "fresh subagent per task"

That model works well for isolation, but it has an obvious cost during iterative implementation. When an implementer finishes a first pass and then receives reviewer feedback or a small follow-up, the next call starts from zero again. The orchestrator must restate context, and the implementer must rebuild understanding of the task, files, and recent decisions.

Recent Pi SDK improvements make a stronger design possible:

- extension session transitions now have clearer semantics in Pi `0.65.x+`
- the SDK exposes in-process `AgentSession` primitives
- session reconstruction is already becoming a first-class concern elsewhere in this package

The opportunity is to introduce continuity where it helps, but only there. The implementer benefits from durable task context. Reviewers generally do not. A reviewer that accumulates too much historical context is more likely to review the narrative of the change instead of the current code and diff.

## Design Goals

- Reuse implementer context within a single task
- Keep reviewer sessions ephemeral and independent
- Let the orchestrator decide re-use silently without interrupting the user
- Make persistence survive normal Pi session transitions such as `new`, `resume`, and `fork`
- Keep the public mental model of the `subagent` tool simple
- Preserve compatibility with current skills as much as practical

## Non-Goals

- Build a full multi-agent UI with manual focus switching between live sessions
- Keep implementer workstreams alive across task completion
- Persist reviewer conversations
- Introduce user-facing commands for full workstream management in the MVP
- Rewrite the entire `subagent` extension around a generic runtime abstraction

## User Scenarios

### 1. Follow-up within the same task

The orchestrator dispatches an implementer for task 2. After review, it needs a targeted fix in the same area. The same implementer workstream is reused, so the agent already understands the task, file set, and earlier trade-offs.

### 2. Task completes, next task starts

The implementer finishes task 2 and the task is marked complete. The workstream is closed. Task 3 starts with a fresh implementer session even if it touches nearby code.

### 3. Mid-task scope shift

While executing a task, the orchestrator realizes the request has drifted into a different subsystem or the existing context is now misleading. It rotates to a fresh implementer workstream for the same task and records why.

### 4. Resume after session transition

The user resumes or forks the parent Pi session while an implementer workstream is still logically active for the current task. The extension reconstructs the workstream registry and can rehydrate the active implementer session for continued use.

## Proposed Approach

Introduce a new internal concept: the **implementer workstream**.

A workstream is a task-scoped execution lane for an implementer. It has stable identity, persisted metadata, and an in-process Pi `AgentSession` that can be reused across multiple prompts while that task remains active.

The `subagent` tool remains the primary interface, but its execution model changes by role:

- `implementer` calls route to a persistent in-process workstream runtime
- reviewer calls continue to use fresh isolated execution

This keeps the orchestrator-facing API familiar while changing the internals to favor continuity for implementation only.

## Architecture

### A. Workstream Registry

Add an internal registry responsible for the lifecycle and persistence of implementer workstreams.

Suggested conceptual shape:

```ts
interface ImplementerWorkstreamRecord {
  workstreamId: string;
  taskKey: string;
  status: "active" | "completed" | "rotated" | "failed";
  cwd: string;
  branch?: string;
  sessionId: string;
  sessionFile?: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
  rotationReason?: string;
}
```

Responsibilities:

- create a workstream for a task
- look up the active workstream for a task
- mark a workstream completed when the task finishes
- rotate a workstream when the orchestrator decides continuity is harmful
- persist metadata so it can be reconstructed after session transitions

The registry stores metadata, not the live `AgentSession` object itself.

### B. Implementer Session Runtime

Add a runtime module that owns in-process Pi `AgentSession` instances for implementer workstreams.

Responsibilities:

- create a fresh `AgentSession` for a new workstream
- reload or recreate a session for a persisted workstream record
- submit prompts to the session
- subscribe to session events needed for summaries and status
- extract structured outputs similar to what the current `subagent` tool returns

The runtime should present the same high-level result shape that the orchestrator already expects where possible:

- final assistant output
- files changed
- tests run
- implementer status such as `DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, or `NEEDS_CONTEXT`

### C. Workstream Selection Policy

Add a policy layer that decides whether to reuse or replace an implementer workstream.

Policy rules for the MVP:

- primary identity is an internal `taskKey`
- if the current task has an active compatible workstream, reuse it
- if the task is marked complete, never reuse the workstream
- if the orchestrator signals major drift, rotate immediately
- if compatibility is ambiguous, prefer creating a new workstream

This policy is silent. It never interrupts the user to ask whether a workstream should be reused.

### D. Reviewer Isolation Boundary

Reviewer roles remain explicitly non-persistent.

Rationale:

- reviewers should inspect the current code and diff with fresh eyes
- persistent review context increases confirmation bias
- review quality benefits from independence more than from conversational continuity

Reviewer persistence in the MVP is limited to artifacts, not sessions:

- written review output
- verdicts
- flagged files
- any orchestrator summaries derived from those reports

### E. Subagent Tool Integration

The `subagent` tool remains the public orchestration surface, but role dispatch changes internally.

For `implementer`:

- resolve task key
- consult workstream policy
- acquire or create workstream
- execute prompt through the in-process runtime
- return structured result

For reviewers:

- execute via fresh invocation path
- do not consult the implementer workstream registry

This keeps skills and orchestrator prompts mostly intact while enabling the new behavior behind the same tool name.

## Task Identity and Workstream Lifetime

The user selected a hybrid rule: workstreams are task-scoped by default, but may be rotated before task completion.

Behavior:

- a new task gets a new implementer workstream
- follow-ups within that task reuse the same workstream
- when the task is completed, the workstream is always closed
- if the task meaningfully changes mid-flight, the orchestrator may rotate to a new workstream for the same task

Examples of valid rotation signals:

- request shifts into a different subsystem
- the agent has clearly built up misleading assumptions
- the accumulated context is too broad or contradictory
- the orchestrator intentionally changes strategy and wants a clean start

## Persistence Model

Workstream metadata should be persisted using the same extension-friendly patterns already used elsewhere in the package.

Recommended approach:

- append extension-owned entries containing workstream registry state
- rebuild the registry from the latest relevant entries on `session_start`

Conceptual persisted payload:

```ts
interface PersistedImplementerState {
  activeWorkstreams: ImplementerWorkstreamRecord[];
}
```

Persistence rules:

- persist on create
- persist on reuse if usage counters or timestamps change
- persist on rotation
- persist on completion

The live in-process runtime is rehydrated from persisted metadata after `new`, `resume`, or `fork`. If exact session restoration is not possible, the runtime recreates a new in-process session seeded from the persisted session identity and task context.

## Session Transition Semantics

This design should align with the ongoing Pi `0.65.x+` session transition work instead of inventing a parallel model.

Behavioral rules:

- `startup`: initialize empty runtime registry from persisted state if present
- `reload`: rebuild runtime bindings without changing workstream state
- `new`: reconstruct workstream metadata in the new session context
- `resume`: reconstruct active workstreams and attempt runtime rehydration
- `fork`: reconstruct metadata while preserving fork semantics for the parent session relationship

No special behavior is required for `session_tree` beyond preserving persisted state consistency.

## User Experience

The MVP should expose light observability without turning workstream management into a full user-facing product.

Desired UX:

- no prompts asking the user whether to reuse an implementer
- status line or widget text indicating the currently active implementer workstream for the active task
- optional short signals such as "reused", "rotated", or "fresh"

Examples:

- `Implementer: task-2 active`
- `Implementer: task-2 reused`
- `Implementer: task-2 rotated`

The MVP should not yet expose:

- commands to list all workstreams
- manual attach/detach controls
- explicit user commands to resume a specific implementer session

## Error Handling and Recovery

The system should prefer safe fallback over clever recovery.

Rules:

- if a persisted implementer session cannot be rehydrated, create a fresh workstream runtime and record a recovery reason
- if workstream/task mapping is ambiguous, create a fresh workstream
- if runtime state appears corrupted, retire the workstream and create a new one
- if an implementer session grows too large or too stale for reliable use, the orchestrator may rotate it

Recovery should be observable in logs and, where appropriate, visible in lightweight status text.

## Testing Strategy

### Unit Tests

- create a new implementer workstream for a fresh task
- reuse an active workstream for follow-up prompts on the same task
- close a workstream when task completion is recorded
- rotate a workstream when policy indicates drift
- never reuse a reviewer session
- reconstruct persisted workstream metadata on `session_start`
- fall back to fresh runtime creation when rehydration fails

### Integration / Near-Real Tests

- implementer workstream survives `new`, `resume`, and `fork` transitions logically
- subagent tool results for implementer remain compatible with current orchestrator expectations
- widget/status updates reflect active, reused, and rotated states

## Migration and Compatibility

This is a behavior change, so compatibility should be explicit.

Compatibility rules:

- reviewer behavior stays unchanged
- implementer behavior changes from always-fresh to task-scoped reuse
- public `subagent` invocation shape should remain stable for existing prompts and skills

Documentation updates should call out the new behavior clearly:

- implementers now retain task context within a task
- reviewers remain fresh by design
- a task boundary still forces a new implementer session

## Open Implementation Questions

These are implementation concerns, not product-level design blockers:

- how best to derive `taskKey` from existing orchestrator/task context
- whether to keep a tiny compatibility wrapper around the current subprocess path during rollout
- what exact session bootstrap data is needed for reliable in-process rehydration

The implementation plan should resolve these concretely, but they do not block approval of the architecture direction.

## Summary

The design introduces persistent implementer workstreams as a focused continuity mechanism inside `pi-superpowers-plus`.

It keeps the useful part of persistence:

- faster follow-ups
- lower re-context cost
- better continuity within a task

And avoids the risky part:

- reviewer bias
- long-lived context across completed tasks
- UI complexity beyond what the Pi SDK currently supports natively

The result is a hybrid model:

- persistent implementer per task
- fresh reviewer per review round
- orchestrator-controlled silent reuse
- task completion and major drift as hard boundaries
