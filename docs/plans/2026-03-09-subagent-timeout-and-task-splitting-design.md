# Subagent Timeout and Task Splitting Design

**Date:** 2026-03-09
**Status:** Approved

## Overview

Two improvements to subagent-driven development workflow:

1. Increase implementer subagent inactivity timeout from 120s to 480s
2. Auto-split failing tasks after 2 attempts instead of stopping

---

## Change #1: Increase Inactivity Timeout

### Current Behavior

- `INACTIVITY_TIMEOUT_MS = 120_000` (2 minutes)
- Subagent killed if no `message_end` event for 2 minutes

### New Behavior

- `INACTIVITY_TIMEOUT_MS = 480_000` (8 minutes)
- More headroom for complex implementation tasks

### Files to Change

1. `extensions/subagent/index.ts:34` — update constant value
2. `tests/extension/subagent/index-error-handling.test.ts:155,208,221` — update test expectations

### Rationale

Complex implementation tasks may require extended thinking time, long test runs, or other operations that don't produce `message_end` events. 8 minutes provides sufficient headroom without being excessive.

---

## Change #2: Auto-Split Failing Tasks

### Current Behavior

From `skills/subagent-driven-development/SKILL.md`:

```
1. Attempt 1: Dispatch fix subagent with specific instructions about the error
2. Attempt 2: Dispatch subagent with different approach or simplified scope
3. After 2 failures: STOP and ask user how to proceed
```

### New Behavior

```
1. Attempt 1: Dispatch fix subagent with specific instructions about the error
2. Attempt 2: Dispatch subagent with different approach or simplified scope
3. After 2 failures:
   a. Main agent splits task into 2-3 smaller parts
   b. Updates plan via plan_tracker
   c. Continues execution with new subtasks
4. If a subtask fails 2x: STOP and ask user (no further splitting)
```

### Task Splitting Guidelines

Main agent should consider when splitting:

- **Natural granularity:** Functions, modules, layers (e.g., backend vs frontend, setup vs logic vs tests)
- **Complexity:** Isolate complex or error-prone parts
- **Dependencies:** Ensure subtasks can execute in logical sequence
- **Size:** Each part small enough to complete without failing

**No-split case:** If task is already atomic/too simple, agent may decide not to split and ask user directly.

### Plan Tracker Integration

**Workflow for updating the plan:**

1. Agent knows which task failed (tracked during execution)
2. Agent creates 2-3 subtask descriptions
3. Agent reconstructs task list:
   - Keep completed tasks (with `complete` status)
   - Replace failed task with subtasks (with `pending` status)
   - Keep future tasks (with `pending` status)
4. Agent updates plan_tracker:
   ```
   plan_tracker({ action: "init", tasks: [reconstructed-list] })
   plan_tracker({ action: "update", index: 0, status: "complete" })
   plan_tracker({ action: "update", index: 1, status: "complete" })
   ...
   ```
5. Continue normal execution loop

**Note:** Agent doesn't need to call `status` first — it already knows task states from orchestration.

### Files to Change

1. `skills/subagent-driven-development/SKILL.md` — update "When a Subagent Fails" section

### Example Flow

**Initial state:**
```
[0] ✓ Setup project
[1] → Implement JWT auth  ← failed 2x
[2] ○ Create user dashboard
[3] ○ Add integration tests
```

**After 2 failures on task 1:**

1. Agent splits "Implement JWT auth" into:
   - "Create JWT validation middleware"
   - "Implement login endpoint"
   - "Add refresh token support"

2. Agent updates plan:
   ```
   plan_tracker({ action: "init", tasks: [
     "Setup project",
     "Create JWT validation middleware",
     "Implement login endpoint",
     "Add refresh token support",
     "Create user dashboard",
     "Add integration tests"
   ]})
   plan_tracker({ action: "update", index: 0, status: "complete" })
   ```

3. **Final state:**
   ```
   [0] ✓ Setup project
   [1] → Create JWT validation middleware  ← next to execute
   [2] ○ Implement login endpoint
   [3] ○ Add refresh token support
   [4] ○ Create user dashboard
   [5] ○ Add integration tests
   ```

4. Continue execution with task 1

**If subtask fails 2x:** STOP and ask user (no further splitting — max 1 level of division)

---

## Implementation Notes

### Change #1

Trivial change — update constant and test expectations.

### Change #2

Documentation-only change to SKILL.md. No code changes required to plan_tracker or subagent tool.

The key instruction updates in SKILL.md:

1. Replace step 3 in "When a Subagent Fails" section
2. Add task splitting guidelines
3. Add plan_tracker update workflow
4. Add example flow
5. Clarify 1-level max division rule

---

## Summary

| Change | Complexity | Risk |
|--------|------------|------|
| #1 Timeout increase | Low | Low |
| #2 Task splitting | Medium (docs only) | Low |

Both changes improve robustness of subagent-driven development without requiring code changes to tools.
