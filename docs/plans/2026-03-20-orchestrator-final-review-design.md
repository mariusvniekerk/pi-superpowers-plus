# Orchestrator Final Review - Design Document

**Date:** 2026-03-20
**Author:** Design session
**Status:** Draft

## Problem Statement

The subagent-driven-development workflow dispatches specialized subagents for implementation, spec compliance review, and code quality review. However, these subagents lack visibility into the broader project context — they see only the task at hand.

The orchestrator (the main agent running the skill) has full context: the complete plan, decisions made in previous tasks, and the project's architectural direction. This context is currently underutilized.

We want to add a final orchestrator review after code quality review, before marking each task complete, to leverage this global perspective.

## Goal

Add an orchestrator review step that:
1. Catches inconsistencies between tasks
2. Detects side effects on completed work
3. Validates readiness for upcoming tasks
4. Ensures alignment with business context
5. Keeps orchestrator context growth bounded

## Design

### High-Level Flow

```
Implementer → Spec Reviewer → Code Quality Reviewer → ORCHESTRATOR → Task complete
```

### Orchestrator Review Process

After code quality reviewer approves, the orchestrator:

1. **Read the Review Summary** — Structured output from code-quality-reviewer
2. **Check flags** — If flags are present, open those specific files
3. **Cross-reference mentally** — Previous tasks, upcoming tasks, global context
4. **Act if needed** — Fix directly, re-dispatch implementer, or escalate

### Review Summary Format

The code-quality-reviewer must produce this structured output:

```markdown
## Review Summary

**Files changed:** [`path/to/file1.ts`, `path/to/file2.ts`]

**What was implemented:** [2-3 sentences describing the main implementation]

**Dependencies affected:** [list of imports/exports that changed, or "none"]

**Flags for orchestrator:** [list of flags requiring orchestrator attention, or "none"]
- Examples: "Modified shared utility", "Changed internal API signature", "Touched hot path", "New dependency added"

**Verdict:** ✅ Approved / ❌ Needs fixes
```

### Context Control Strategy

To prevent context explosion:

- Orchestrator reads only the Review Summary (short, structured)
- Opens specific files only when flags are present
- Cross-reference is mental — orchestrator already has plan context and previous task history
- No full code review — that's the code-quality-reviewer's job

### Orchestrator Action Matrix

| Problem type | Action |
|--------------|--------|
| Typos, unused imports, local variable names | Fix directly |
| Rename private functions/methods, adjust error messages | Fix directly |
| Small logic adjustments in isolated functions | Fix directly |
| Add small helper functions | Fix directly |
| Adjust internal (non-public) function signatures | Fix directly |
| Refactor code within a single function | Fix directly |
| Changes to public APIs or shared modules | Re-dispatch implementer |
| Logic changes affecting multiple files | Re-dispatch implementer |
| Architectural concerns | Escalate to user |

## Implementation

### Files to Modify

1. **`skills/subagent-driven-development/SKILL.md`**
   - Add "Orchestrator Review" section with process and action matrix
   - Update DOT diagram with new flow
   - Update example workflow to show orchestrator review

2. **`skills/subagent-driven-development/code-quality-reviewer-prompt.md`**
   - Add required Review Summary output format

### No New Files Required

All changes fit into existing files.

## Updated Flow Diagram

```dot
digraph process {
    rankdir=TB;

    "Dispatch code quality reviewer" [shape=box];
    "Code quality reviewer approves?" [shape=diamond];
    "Orchestrator reads Review Summary" [shape=box];
    "Flags or concerns?" [shape=diamond];
    "Orchestrator reviews flagged files" [shape=box];
    "Issues found?" [shape=diamond];
    "Small fix (see matrix)?" [shape=diamond];
    "Orchestrator fixes directly" [shape=box];
    "Re-dispatch implementer" [shape=box];
    "Escalate to user" [shape=box];
    "Mark task complete" [shape=box style=filled fillcolor=lightgreen];

    "Dispatch code quality reviewer" -> "Code quality reviewer approves?";
    "Code quality reviewer approves?" -> "Implementer fixes" [label="no"];
    "Implementer fixes" -> "Dispatch code quality reviewer" [label="re-review"];
    "Code quality reviewer approves?" -> "Orchestrator reads Review Summary" [label="yes"];
    "Orchestrator reads Review Summary" -> "Flags or concerns?";
    "Flags or concerns?" -> "Mark task complete" [label="no"];
    "Flags or concerns?" -> "Orchestrator reviews flagged files" [label="yes"];
    "Orchestrator reviews flagged files" -> "Issues found?";
    "Issues found?" -> "Mark task complete" [label="no"];
    "Issues found?" -> "Small fix (see matrix)?" [label="yes"];
    "Small fix (see matrix)?" -> "Orchestrator fixes directly" [label="yes"];
    "Small fix (see matrix)?" -> "Architectural concern?" [label="no"];
    "Architectural concern?" -> "Escalate to user" [label="yes"];
    "Architectural concern?" -> "Re-dispatch implementer" [label="no"];
    "Orchestrator fixes directly" -> "Mark task complete";
    "Re-dispatch implementer" -> "Dispatch code quality reviewer";
    "Escalate to user" -> "User decision" [label="await"];
}
```

## Example Workflow (Updated)

```
Task 1: Hook installation script

[Implementer completes]
[Spec reviewer approves]
[Code quality reviewer produces:]
  ## Review Summary
  **Files changed:** [`src/hooks/install.ts`, `src/hooks/index.ts`]
  **What was implemented:** Added install-hook command with --force flag support. Registers hook in config file.
  **Dependencies affected:** Exported `installHook` from index.ts
  **Flags for orchestrator:** "Modified shared config module"
  **Verdict:** ✅ Approved

[Orchestrator review:]
  - Reads summary
  - Flag present: opens src/config/index.ts
  - Checks: config module change is additive, no breaking changes
  - Cross-reference: next task needs config read, this prepares well
  - No issues found

[Mark Task 1 complete]

Task 2: Recovery modes

[Implementer completes]
[Spec reviewer approves]
[Code quality reviewer produces:]
  ## Review Summary
  **Files changed:** [`src/hooks/recover.ts`]
  **What was implemented:** Added verify and repair modes with progress reporting every 100 items.
  **Dependencies affected:** none
  **Flags for orchestrator:** none
  **Verdict:** ✅ Approved

[Orchestrator review:]
  - Reads summary
  - No flags
  - Cross-reference: naming "recover" vs Task 1's "install" — consistent pattern
  - No issues found

[Mark Task 2 complete]

...

Task 4: API client

[Implementer completes]
[Spec reviewer approves]
[Code quality reviewer produces:]
  ## Review Summary
  **Files changed:** [`src/api/client.ts`, `src/api/types.ts`]
  **What was implemented:** HTTP client with retry logic and typed responses.
  **Dependencies affected:** Exported ApiClient from client.ts
  **Flags for orchestrator:** "Changed shared error handling"
  **Verdict:** ✅ Approved

[Orchestrator review:]
  - Reads summary
  - Flag present: opens src/utils/errors.ts
  - Checks: error handling change removes `retryCount` field that Task 2's recover.ts uses
  - Issue found: breaking change to shared module
  - Action: re-dispatch implementer with feedback to preserve `retryCount` field
```

## Trade-offs

### Why this approach

- **Leverages existing context** — Orchestrator already has the big picture
- **Bounded context growth** — Only opens specific files when flagged
- **Clear boundaries** — Action matrix prevents scope creep
- **Minimal changes** — Fits into existing files and workflow

### Alternatives considered

1. **Create orchestrator-review-prompt.md** — Rejected: orchestrator is not a subagent
2. **Orchestrator reviews full diff** — Rejected: would explode context
3. **Orchestrator only does sanity checks** — Rejected: too shallow, misses consistency issues

## Success Criteria

- Orchestrator review catches at least one consistency issue per 3-4 tasks (observed in practice)
- No significant context growth for orchestrator (measured by token usage)
- Workflow remains fast — orchestrator review adds <30 seconds per task
- Clear action boundaries — no ambiguity about when to fix vs re-dispatch
