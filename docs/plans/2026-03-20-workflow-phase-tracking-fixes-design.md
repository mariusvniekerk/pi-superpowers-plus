# Workflow Phase Tracking Fixes

**Date:** 2026-03-20
**Status:** Draft
**Scope:** Fix workflow tracker incorrectly advancing phases and not recognizing inline verification/review

## Problem Statement

Two issues with the workflow phase tracking:

1. **Phases "jump" unexpectedly in the same session** — User starts in brainstorming, but workflow shows "execute" because the Pi loaded `subagent-driven-development/SKILL.md` when listing available skills. The last skill file read "wins" and sets the current phase.

2. **Verify and Review phases marked as "skipped" after finishing** — When implementation completes via subagent-driven and user says "yes, continue", the finishing skill runs tests and does inline checks, but these don't trigger the workflow tracker to mark `verify` and `review` as complete.

## Root Cause Analysis

### Issue 1: Spurious Phase Transitions from Skill File Reads

In `extensions/workflow-monitor.ts`, the `tool_result` handler calls `handleSkillFileRead` for any `SKILL.md` read:

```ts
if (event.toolName === "read") {
  const path = ((event.input as Record<string, any>).path as string) ?? "";
  if (handler.handleSkillFileRead(path)) {
    persistState();
  }
  handler.handleReadOrInvestigation("read", path);
}
```

This triggers `advanceTo()` in `workflow-tracker.ts`:

```ts
onSkillFileRead(path: string): boolean {
  const match = path.match(/\/skills\/([^/]+)\/SKILL\.md$/);
  if (!match) return false;
  const phase = SKILL_TO_PHASE[match[1]];
  if (!phase) return false;
  return this.advanceTo(phase);
}
```

Problem: The Pi reads multiple `SKILL.md` files at session start to populate the available skills list. The last one read sets the phase, regardless of user intent.

### Issue 2: Inline Verification/Review Not Recognized

The workflow tracker marks phases complete based on:

- `verify`: Test command passes AND `currentPhase === "verify"`
- `review`: No automatic trigger — only manual skill invocation

The `/skill:finishing-a-development-branch` skill:
- Runs tests internally (Step 1: Verify Tests)
- Does not invoke `/skill:verification-before-completion` or `/skill:requesting-code-review`
- Therefore, `verify` and `review` remain `pending` → appear as "skipped" when `finish` completes

## Proposed Solution

### Fix 1: Remove Skill File Read as Phase Trigger

Remove the automatic phase advancement when reading `SKILL.md` files.

**Phases advance only by:**
1. User input (`/skill:brainstorming`, etc.) — via `handleInputText`
2. Artifact writes (`docs/plans/*-design.md`, `*-implementation.md`) — via `handleFileWritten`
3. `plan_tracker` init — via `handlePlanTrackerToolCall`

**Change in `workflow-monitor.ts`:**
```diff
  if (event.toolName === "read") {
    const path = ((event.input as Record<string, any>).path as string) ?? "";
-   if (handler.handleSkillFileRead(path)) {
-     persistState();
-   }
    handler.handleReadOrInvestigation("read", path);
  }
```

The `handleSkillFileRead` method and `onSkillFileRead` in `workflow-tracker.ts` can remain for potential future use, but won't be called automatically.

### Fix 2: Recognize Verify When Tests Pass in Finishing

When tests pass AND current phase is `finish` AND `verify` is still `pending`, mark `verify` as complete.

**Change in `workflow-monitor.ts` bash handler:**
```ts
if (passed === true) {
  const state = handler.getWorkflowState();

  // Existing: mark verify complete if currently in verify phase
  if (state?.currentPhase === "verify" && state.phases.verify === "active") {
    handler.completeCurrentWorkflowPhase();
    persistState();
  }

  // NEW: mark verify complete if in finish phase and verify is pending
  if (state?.currentPhase === "finish" && state.phases.verify === "pending") {
    handler.advanceWorkflowTo("verify");
    handler.completeCurrentWorkflowPhase();
    handler.advanceWorkflowTo("finish");
    persistState();
  }
}
```

### Fix 3: Recognize Review in Finishing Completion Actions

Detect push/PR creation and merge to mark `review` appropriately.

**Change in `workflow-monitor.ts` bash handler:**

Add regex patterns (already exist for completion action detection):
```ts
const PUSH_RE = /\bgit\s+push\b/;
const PR_RE = /\bgh\s+pr\s+create\b/;
const MERGE_RE = /\bgit\s+merge\b/;
```

Add detection logic:
```ts
// Push or PR created → review will happen externally
if ((PUSH_RE.test(command) || PR_RE.test(command)) && exitCode === 0) {
  const state = handler.getWorkflowState();
  if (state?.currentPhase === "finish" && state.phases.review === "pending") {
    handler.advanceWorkflowTo("review");
    handler.completeCurrentWorkflowPhase();
    handler.advanceWorkflowTo("finish");
    persistState();
  }
}

// Local merge → user took responsibility, skip review
if (MERGE_RE.test(command) && exitCode === 0) {
  const state = handler.getWorkflowState();
  if (state?.currentPhase === "finish" && state.phases.review === "pending") {
    handler.skipWorkflowPhases(["review"]);
    persistState();
  }
}
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User runs tests manually before finishing | `verify` marked complete when tests pass (existing behavior) |
| User explicitly skips verify/review | `skipWorkflowPhases` marks as `skipped` — new code doesn't overwrite |
| Tests fail in finishing | `verify` remains `pending` — correct, user must fix |
| No git (other VCS or none) | Regexes don't match, phases unchanged — user can mark manually |
| Push fails (exitCode !== 0) | `review` not marked — correct, push didn't succeed |

## Files Changed

```
extensions/workflow-monitor.ts
```

No skill files (`SKILL.md`) need modification.

## Testing Strategy

1. **Fix 1 test:** Start session, verify brainstorming skill is active, check that loading available skills doesn't change phase
2. **Fix 2 test:** Complete execution, call finishing, run tests that pass, verify `verify` shows as complete
3. **Fix 3 test:** After tests pass in finishing, do `git push` or `gh pr create`, verify `review` shows as complete
4. **Fix 3 test (merge):** After tests pass, do local merge, verify `review` shows as skipped

## Success Criteria

- Workflow phase stays at correct phase when skills are loaded
- After finishing with passing tests, `verify` shows as `complete` in widget
- After push/PR, `review` shows as `complete` in widget
- After local merge, `review` shows as `skipped` in widget
