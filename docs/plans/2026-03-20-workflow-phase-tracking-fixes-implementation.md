# Workflow Phase Tracking Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use `/skill:subagent-driven-development` (preferred in-session) or `/skill:executing-plans` (parallel session) to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** Fix workflow tracker to not advance phases on skill file reads, and recognize inline verify/review during finishing.

**Architecture:** Three targeted fixes in `workflow-monitor.ts`: (1) remove skill file read as phase trigger, (2) mark verify complete when tests pass during finish, (3) mark review complete/skipped on push/PR/merge.

**Tech Stack:** TypeScript, Vitest, Pi SDK

---

## Task 1: Create Test File and Add Tests for Fix 1

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Create: `tests/extension/workflow-monitor/phase-tracking.test.ts`

- [ ] **Step 1: Create test file with failing test for Fix 1**

Create a new test file following the existing integration test patterns:

```typescript
import { describe, expect, test } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";
import { createFakePi, getSingleHandler } from "./test-helpers";

describe("Phase Tracking Integration Tests", () => {
  test("reading skill file does NOT advance workflow phase", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    // Start in brainstorm phase
    await inputHandler({ text: "/skill:brainstorming" }, { hasUI: false });

    // Simulate reading a different skill file (as Pi does when loading available skills)
    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "read",
        input: { path: "/path/to/skills/subagent-driven-development/SKILL.md" },
        content: [{ type: "text", text: "---\nname: subagent-driven-development\n..." }],
      },
      { hasUI: false },
    );

    // Phase should still be brainstorm, NOT execute
    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const lastState = stateEntries[stateEntries.length - 1]?.data.workflow;
    expect(lastState?.currentPhase).toBe("brainstorm");
    expect(lastState?.phases.execute).toBe("pending");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/extension/workflow-monitor/phase-tracking.test.ts`
Expected: FAIL — currentPhase changes to "execute" after reading skill file

---

## Task 2: Implement Fix 1 (Remove Skill File Read Trigger in Extension)

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Modify: `extensions/workflow-monitor.ts`

- [ ] **Step 1: Run existing tests to establish baseline**

Run: `pnpm test tests/extension/workflow-monitor/`
Expected: All tests pass

- [ ] **Step 2: Remove handleSkillFileRead call from tool_result handler**

In `extensions/workflow-monitor.ts`, find the `tool_result` handler and remove the skill file read trigger. Search for the pattern:

```diff
    if (event.toolName === "read") {
      // biome-ignore lint/suspicious/noExplicitAny: pi SDK event input type
      const path = ((event.input as Record<string, any>).path as string) ?? "";
-     if (handler.handleSkillFileRead(path)) {
-       persistState();
-     }
      handler.handleReadOrInvestigation("read", path);
    }
```

- [ ] **Step 3: Run all workflow-monitor tests**

Run: `pnpm test tests/extension/workflow-monitor/`
Expected: All tests pass including new test from Task 1

- [ ] **Step 4: Commit**

```bash
git add extensions/workflow-monitor.ts tests/extension/workflow-monitor/phase-tracking.test.ts
git commit -m "fix(workflow): remove skill file read as phase trigger

Reading SKILL.md files no longer advances workflow phases.
Prevents spurious phase transitions when Pi loads available skills.

Fixes issue #1 from design doc."
```

---

## Task 3: Add Tests for Fix 2 (Verify Recognition in Finishing)

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Modify: `tests/extension/workflow-monitor/phase-tracking.test.ts`

- [ ] **Step 1: Add failing test for Fix 2**

Add a test to verify that tests passing during finish phase marks verify as complete:

```typescript
  test("tests passing during finish phase marks verify as complete", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    // Advance to finish phase
    await inputHandler({ text: "/skill:finishing-a-development-branch" }, { hasUI: false });

    // Simulate tests passing
    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "npm test" },
        content: [{ type: "text", text: "5 tests passed" }],
        details: { exitCode: 0 },
      },
      { hasUI: false },
    );

    // Verify should now be complete
    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    expect(stateEntries.length).toBeGreaterThan(0);
    const lastState = stateEntries[stateEntries.length - 1].data.workflow;
    expect(lastState.phases.verify).toBe("complete");
    expect(lastState.currentPhase).toBe("finish");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/extension/workflow-monitor/phase-tracking.test.ts -t "tests passing during finish"`
Expected: FAIL — verify is not marked complete when in finish phase

---

## Task 4: Implement Fix 2 (Recognize Verify in Finishing)

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Modify: `extensions/workflow-monitor.ts`

- [ ] **Step 1: Run existing tests to establish baseline**

Run: `pnpm test tests/extension/workflow-monitor/`
Expected: All tests pass

- [ ] **Step 2: Add verify recognition logic when in finish phase**

In `extensions/workflow-monitor.ts`, find the bash handler's test result section. Search for `if (passed === true)` and add the new logic after the existing verify completion block:

```diff
      if (passed === true) {
        const state = handler.getWorkflowState();
        if (state?.currentPhase === "verify" && state.phases.verify === "active") {
          if (handler.completeCurrentWorkflowPhase()) {
            persistState();
          }
        }
+       // Fix 2: Mark verify complete if in finish phase and verify is pending
+       if (state?.currentPhase === "finish" && state.phases.verify === "pending") {
+         handler.advanceWorkflowTo("verify");
+         handler.completeCurrentWorkflowPhase();
+         handler.advanceWorkflowTo("finish");
+         persistState();
+       }
      }
```

- [ ] **Step 3: Run all workflow-monitor tests**

Run: `pnpm test tests/extension/workflow-monitor/`
Expected: All tests pass including new test from Task 3

- [ ] **Step 4: Commit**

```bash
git add extensions/workflow-monitor.ts tests/extension/workflow-monitor/phase-tracking.test.ts
git commit -m "fix(workflow): recognize verify when tests pass during finish

When tests pass during the finishing phase, mark verify as complete.
This ensures inline verification in finishing skill is recognized.

Fixes issue #2a from design doc."
```

---

## Task 5: Add Tests for Fix 3 (Review Recognition on Push/PR/Merge)

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Modify: `tests/extension/workflow-monitor/phase-tracking.test.ts`

- [ ] **Step 1: Add failing tests for Fix 3**

Add three tests for review recognition:

```typescript
  test("git push during finish marks review as complete", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    await inputHandler({ text: "/skill:finishing-a-development-branch" }, { hasUI: false });

    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git push origin main" },
        content: [{ type: "text", text: "pushed" }],
        details: { exitCode: 0 },
      },
      { hasUI: false },
    );

    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const lastState = stateEntries[stateEntries.length - 1].data.workflow;
    expect(lastState.phases.review).toBe("complete");
    expect(lastState.currentPhase).toBe("finish");
  });

  test("gh pr create during finish marks review as complete", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    await inputHandler({ text: "/skill:finishing-a-development-branch" }, { hasUI: false });

    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "gh pr create --title 'Feature'" },
        content: [{ type: "text", text: "created PR #123" }],
        details: { exitCode: 0 },
      },
      { hasUI: false },
    );

    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const lastState = stateEntries[stateEntries.length - 1].data.workflow;
    expect(lastState.phases.review).toBe("complete");
  });

  test("git merge during finish marks review as skipped", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    await inputHandler({ text: "/skill:finishing-a-development-branch" }, { hasUI: false });

    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git merge feature-branch" },
        content: [{ type: "text", text: "merged" }],
        details: { exitCode: 0 },
      },
      { hasUI: false },
    );

    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const lastState = stateEntries[stateEntries.length - 1].data.workflow;
    expect(lastState.phases.review).toBe("skipped");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/extension/workflow-monitor/phase-tracking.test.ts -t "git push|gh pr|git merge"`
Expected: FAIL — review is not marked on push/PR/merge

---

## Task 6: Implement Fix 3 (Recognize Review on Push/PR/Merge)

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Modify: `extensions/workflow-monitor.ts`

- [ ] **Step 1: Run existing tests to establish baseline**

Run: `pnpm test tests/extension/workflow-monitor/`
Expected: All tests pass

- [ ] **Step 2: Add MERGE_RE regex constant**

Add the regex constant near the existing ones. Search for `const PR_RE`:

```diff
  const COMMIT_RE = /\bgit\s+commit\b/;
  const PUSH_RE = /\bgit\s+push\b/;
  const PR_RE = /\bgh\s+pr\s+create\b/;
+ const MERGE_RE = /\bgit\s+merge\b/;
```

- [ ] **Step 3: Add review recognition logic in bash handler**

In the bash handler's tool_result section, after the existing test result handling, add. Search for `pendingVerificationViolations.delete(toolCallId);`:

```typescript
// Fix 3: Recognize review on push/PR/merge during finish
if (exitCode === 0) {
  const state = handler.getWorkflowState();
  if (state?.currentPhase === "finish" && state.phases.review === "pending") {
    // Push or PR created → review will happen externally
    if (PUSH_RE.test(command) || PR_RE.test(command)) {
      handler.advanceWorkflowTo("review");
      handler.completeCurrentWorkflowPhase();
      handler.advanceWorkflowTo("finish");
      persistState();
    }
    // Local merge → user took responsibility
    if (MERGE_RE.test(command)) {
      handler.skipWorkflowPhases(["review"]);
      persistState();
    }
  }
}
```

- [ ] **Step 4: Run all workflow-monitor tests**

Run: `pnpm test tests/extension/workflow-monitor/`
Expected: All tests pass including new tests from Task 5

- [ ] **Step 5: Commit**

```bash
git add extensions/workflow-monitor.ts tests/extension/workflow-monitor/phase-tracking.test.ts
git commit -m "fix(workflow): recognize review on push/PR/merge during finish

- git push or gh pr create → marks review as complete
- git merge → marks review as skipped (user took responsibility)

Fixes issue #2b from design doc."
```

---

## Task 7: Run Full Test Suite and Final Verification

**TDD scenario:** Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 2: Run linter**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Manual verification (if applicable)**

In a Pi session:
1. Start brainstorming → verify phase shows "brainstorm"
2. Load available skills → verify phase still shows "brainstorm" (not jumping)
3. Complete implementation, call finishing → run tests → verify shows "complete"
4. Do git push → review shows "complete"

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: final cleanup for workflow phase tracking fixes"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create test file, add tests for Fix 1 | `phase-tracking.test.ts` (new) |
| 2 | Implement Fix 1 | `workflow-monitor.ts` |
| 3 | Add tests for Fix 2 | `phase-tracking.test.ts` |
| 4 | Implement Fix 2 | `workflow-monitor.ts` |
| 5 | Add tests for Fix 3 | `phase-tracking.test.ts` |
| 6 | Implement Fix 3 | `workflow-monitor.ts` |
| 7 | Full verification | — |

**Estimated effort:** 7 tasks, ~30-45 minutes total
