# Subagent Timeout and Task Splitting Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill or subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Increase implementer inactivity timeout from 120s to 480s and add auto-splitting of failing tasks after 2 attempts.

**Architecture:** Two independent changes — a trivial constant update with test fix, and a documentation-only update to the subagent-driven-development skill.

**Tech Stack:** TypeScript, Vitest, Markdown

---

## Task 1: Update Inactivity Timeout Constant

**TDD scenario:** Trivial change — update constant and fix existing test expectations

**Files:**
- Modify: `extensions/subagent/index.ts:34`
- Modify: `tests/extension/subagent/index-error-handling.test.ts:155,208,221`

**Step 1: Update the constant**

In `extensions/subagent/index.ts`, change line 34:

```typescript
// FROM:
export const INACTIVITY_TIMEOUT_MS = 120_000;

// TO:
export const INACTIVITY_TIMEOUT_MS = 480_000;
```

**Step 2: Update test expectation**

In `tests/extension/subagent/index-error-handling.test.ts`, change line 155:

```typescript
// FROM:
expect(INACTIVITY_TIMEOUT_MS).toBe(120_000);

// TO:
expect(INACTIVITY_TIMEOUT_MS).toBe(480_000);
```

**Step 3: Update test comments**

In `tests/extension/subagent/index-error-handling.test.ts`, update comments on lines 208 and 221:

```typescript
// FROM (line 208):
// Set absolute timeout shorter than inactivity timeout (120s)

// TO:
// Set absolute timeout shorter than inactivity timeout (480s)
```

```typescript
// FROM (line 221):
// Advance past the 30s absolute timeout but before 120s inactivity

// TO:
// Advance past the 30s absolute timeout but before 480s inactivity
```

**Step 4: Run tests to verify**

Run: `npm test -- tests/extension/subagent/index-error-handling.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add extensions/subagent/index.ts tests/extension/subagent/index-error-handling.test.ts
git commit -m "feat: increase subagent inactivity timeout from 120s to 480s"
```

---

## Task 2: Update SKILL.md with Task Splitting Behavior

**TDD scenario:** Documentation-only change — no tests needed

**Files:**
- Modify: `skills/subagent-driven-development/SKILL.md`

**Step 1: Update "When a Subagent Fails" section**

Replace the entire "When a Subagent Fails" section (lines ~221-241) with:

```markdown
## When a Subagent Fails

**You are the orchestrator. You do NOT write code. You dispatch subagents that write code.**

If an implementer subagent fails, errors out, or produces incomplete work:

1. **Attempt 1:** Dispatch a NEW fix subagent with specific instructions about what went wrong and what needs to change. Include the error output and the original task text.
2. **Attempt 2:** If the fix subagent also fails, dispatch one more with a different approach or simplified scope.
3. **After 2 failed attempts: Split the task and continue.**
   - Analyze the failing task and divide it into 2-3 smaller, more manageable parts
   - Consider: natural granularity (functions, modules, layers), complexity isolation, logical dependencies, and size reduction
   - If the task is already too simple to split, skip to step 5
4. **Update the plan:**
   - Reconstruct the task list: completed tasks + new subtasks + remaining tasks
   - Call `plan_tracker({ action: "init", tasks: [reconstructed-list] })`
   - Mark completed tasks: `plan_tracker({ action: "update", index: N, status: "complete" })` for each
   - Continue execution with the first new subtask
5. **If a subtask also fails 2x: STOP.** Report to the user. Maximum 1 level of task division.

**Task Splitting Guidelines:**

When dividing a failing task, consider:
- **Natural granularity:** Split along functional boundaries (e.g., backend vs frontend, setup vs logic vs tests)
- **Complexity:** Isolate the most complex or error-prone parts into separate tasks
- **Dependencies:** Ensure subtasks can execute in logical sequence
- **Size:** Each subtask should be small enough to complete without hitting the same failure mode

**Example:**

Original task: "Implement JWT authentication"

After 2 failures, split into:
1. "Create JWT validation middleware"
2. "Implement login endpoint with token generation"
3. "Add refresh token support"

**NEVER:**
- Write code yourself to "help" or "finish up" — you are the orchestrator, not an implementer
- Try to fix the subagent's work inline — this pollutes your context and defeats the fresh-subagent model
- Silently skip the failed task and move on
- Reduce quality gates (skip reviews) because a task is "almost done"
- Split tasks more than once (max 1 level of division)
```

**Step 2: Verify markdown renders correctly**

Open the file in an editor or markdown viewer to confirm formatting is correct.

**Step 3: Commit**

```bash
git add skills/subagent-driven-development/SKILL.md
git commit -m "feat: add auto task-splitting after 2 subagent failures"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Increase inactivity timeout | 2 files |
| 2 | Add task splitting behavior | 1 file |

Both tasks are independent and can be executed in any order.
