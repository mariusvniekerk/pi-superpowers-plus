# Subagent Migration To Pi-Subagents Design

**Date:** 2026-04-12
**Status:** Draft for review
**Scope:** package architecture, shipped Pi extensions, skills, bundled agent definitions, docs, and tests related to subagent orchestration

## Goal

Replace the repo's local subagent runtime with upstream `nicobailon/pi-subagents`, while preserving `pi-superpowers-plus` as the owner of workflow discipline, structured agent protocols, and shipped agent definitions.

The migration should remove a flaky area of this package, reduce long-term maintenance burden, and make subagent behavior inherit upstream fixes and feature work by default.

## Problem Statement

`pi-superpowers-plus` currently ships its own bundled subagent runtime under `extensions/subagent/`. That runtime has grown into a package-specific orchestration system with local result parsing, bundled agent roles, workstream behavior, and role-specific assumptions.

That design has two problems:

- the runtime behaves flakily in practice
- the package now owns a high-complexity orchestration layer that upstream packages are actively improving elsewhere

At the same time, the workflow model in this package still depends on structured agent behavior:

- implementers report explicit task outcomes
- reviewers and planners follow role-specific output formats
- orchestration skills expect predictable end-of-run structure

The design challenge is to drop the local runtime without dropping the workflow guarantees that matter.

## Design Goals

- Remove the bundled local subagent runtime from this package
- Adopt upstream `pi-subagents` as the execution engine
- Keep repo-owned agent definitions for the workflow roles this package depends on
- Preserve structured output contracts such as `implementerStatus`
- Add automatic protocol repair when structured output is missing or malformed
- Make `pi-subagents` a direct dependency so users do not need a separate install step
- Align our agent definitions with upstream conventions where sensible, without giving up package-specific workflow behavior

## Non-Goals

- Preserve backward compatibility with the old local subagent runtime
- Support both runtimes in parallel
- Keep local workstream persistence or the exact old result schema as runtime features
- Recreate the entire old extension as a compatibility shim
- Depend on upstream built-in agents as the canonical definitions for this package

## Proposed Approach

`pi-superpowers-plus` will stop shipping a subagent runtime and instead depend directly on `pi-subagents` for orchestration.

This package will continue to own:

- workflow skills
- workflow enforcement extensions such as workflow monitoring and plan tracking
- repo-owned agent definitions
- structured protocol rules for agents used by the workflow
- orchestration-side parsing and repair logic for those structured outputs

This package will stop owning:

- subagent process spawning
- async orchestration internals
- chain and parallel execution internals
- local workstream/session orchestration
- local subagent result transport and rendering

## Architecture

### A. Runtime Ownership

`pi-subagents` becomes the single orchestration runtime. `pi-superpowers-plus` should no longer register `extensions/subagent/index.ts` in `package.json`, and the package should no longer ship `extensions/subagent/` as an active runtime surface.

The resulting architecture is:

- `pi-subagents` owns agent execution
- `pi-superpowers-plus` owns workflow behavior layered on top of that execution

This makes the boundary clear and avoids reintroducing a second orchestration system by accident.

### B. Direct Dependency

`pi-superpowers-plus` should declare `pi-subagents` as a direct package dependency.

Rationale:

- no extra manual install step for users
- versioned dependency managed with this package
- clearer support surface
- easier docs and testing

If upstream install wiring still requires explicit Pi package configuration at runtime, the package docs should say so clearly, but the npm dependency relationship should still be direct.

### C. Repo-Owned Agent Definitions

This package should continue shipping its own agent definitions for the roles its workflow depends on.

Those definitions should be adapted to upstream `pi-subagents` conventions where sensible:

- frontmatter shape
- tool declarations
- model/thinking defaults
- skills and extension controls where supported
- output and reads behavior where supported

But the package should not defer role behavior to upstream built-in agents. The workflow depends on specific agent roles such as:

- implementer
- worker
- code reviewer
- quality/spec reviewer
- critical reviewer
- investigator
- internet researcher
- test runner
- test effectiveness analyst

These roles are part of the package's behavior contract and should remain repo-owned.

### D. Structured Output Protocols

Structured output contracts should move from runtime internals into agent prompts plus orchestration validation.

Example:

- implementers still end with `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`
- reviewer-style agents return clearly delimited sections required by the workflow
- any agent that the workflow treats as structured must declare and follow a strict output format

This package should treat those protocols as first-class workflow contracts, even though upstream runtime transport is now generic.

### E. Protocol Repair Loop

For any repo-owned structured agent, the orchestrating workflow should validate the final output after the run completes.

If required structure is missing or malformed:

1. send an automatic follow-up asking the subagent to repair only the missing structured parts
2. revalidate the result
3. repeat up to 3 times total
4. if still invalid, stop automation and hand control back to the main agent for user confirmation

Key rules:

- this applies to all spawned agents with required structured parts, not only implementers
- the repair loop should be narrow and mechanical, not a free-form retry of the whole task
- after 3 failed repairs, the main agent must not silently infer success

This gives the package a reliable protocol layer without rebuilding a local execution engine.

### F. Implementer Status

`implementerStatus` should be preserved, but as a prompt-level protocol rather than a native runtime field.

The orchestrator should:

- require the final `Status:` line in the implementer prompt
- parse it from the final output
- invoke the protocol repair loop if it is missing or malformed

If the repair loop still fails after 3 attempts, the main agent should escalate to the user instead of pretending the task outcome is known.

### G. Skills And Prompt Integration

Skills that currently assume the local subagent runtime must be rewritten to target upstream `pi-subagents`.

Priority updates:

- `skills/subagent-driven-development/`
- `skills/dispatching-parallel-agents/`
- `skills/requesting-code-review/`
- any prompt templates that currently assume local result details such as `implementerStatus` being injected by runtime code

The new skills should:

- invoke upstream-native subagent patterns
- refer to repo-owned structured agents
- describe the protocol repair behavior
- stop promising local runtime capabilities that no longer exist

### H. Documentation

README and migration docs must describe the new boundary clearly:

- `pi-superpowers-plus` provides workflow structure and enforcement
- `pi-subagents` provides orchestration
- this package ships its own agent definitions on top of that runtime

Docs should also explicitly state that backward compatibility with the previous local subagent engine is not a goal of this migration.

## Removal And Replacement Plan

### Remove

- local `extensions/subagent/` runtime from shipped package configuration
- local docs that present this package as owning a standalone subagent engine
- tests whose only purpose is validating the old local runtime internals

### Replace

- local runtime assumptions with upstream `pi-subagents` integration
- local bundled agent behavior with repo-owned upstream-compatible agent definitions
- local structured result extraction with prompt-based structured output plus validation and repair

## Testing Strategy

The new tests should validate package behavior rather than re-testing orchestration internals already owned by upstream.

Focus areas:

- package configuration includes the correct runtime dependency and no longer registers the local subagent extension
- bundled agent definitions conform to the expected upstream-compatible format
- skill content references the new orchestration model correctly
- structured output parsing works for all structured agents
- malformed structured output triggers the repair loop
- after 3 failed repairs, orchestration escalates instead of silently guessing

Testing should shift away from process-lifecycle minutiae in `extensions/subagent/*` and toward workflow-level correctness.

## Risks

### 1. Feature Mismatch

Some local behaviors, such as persistent implementer workstreams, may not exist upstream in the same form.

Mitigation:

- do not preserve them unless they are still necessary after migration
- reintroduce workflow-level protocol behavior only where it provides clear value

### 2. Agent Drift

Moving structured behavior into prompts creates a risk that agents drift from required formats.

Mitigation:

- strict prompt contracts
- narrow repair prompts
- tests against required output structure

### 3. Migration Churn

The repo currently has docs, tests, and skills tightly coupled to the local runtime.

Mitigation:

- treat this as a deliberate breaking internal migration
- remove obsolete assumptions instead of trying to preserve them

## Open Decisions Resolved

- backward compatibility: explicitly not required
- runtime strategy: full migration, no shim, no dual-stack
- dependency strategy: direct dependency on `pi-subagents`
- agent ownership: repo ships its own agents
- structured outputs: preserved through prompt contracts and repair logic
- repair limit: 3 automatic follow-ups, then escalate to user confirmation

## Recommendation

Proceed with a full native migration to `pi-subagents`.

This is the cleanest path because it removes a flaky subsystem entirely, keeps ownership of the workflow behavior that differentiates `pi-superpowers-plus`, and leaves orchestration mechanics to an upstream package that is currently more active and more likely to improve over time.
