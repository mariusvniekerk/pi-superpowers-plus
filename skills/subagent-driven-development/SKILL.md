---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session
---

> **Related skills:** Need an isolated workspace? `/skill:using-git-worktrees`. Need a plan first? `/skill:writing-plans`. Done? `/skill:finishing-a-development-branch`.

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: Quality+Spec review first, then Critical/Safety review.

**Core principle:** Fresh subagent per task + two-stage review (quality+spec → critical) = high quality, catches blind spots

If a tool result contains a ⚠️ workflow warning, stop immediately and address it before continuing.

## Prerequisites
- Active branch (not main) or user-confirmed intent to work on main
- Approved plan or clear task scope

## When to Use

```dot
digraph when_to_use {
    "Have implementation plan?" [shape=diamond];
    "Tasks mostly independent?" [shape=diamond];
    "Stay in this session?" [shape=diamond];
    "subagent-driven-development" [shape=box];
    "executing-plans" [shape=box];
    "Manual execution or brainstorm first" [shape=box];

    "Have implementation plan?" -> "Tasks mostly independent?" [label="yes"];
    "Have implementation plan?" -> "Manual execution or brainstorm first" [label="no"];
    "Tasks mostly independent?" -> "Stay in this session?" [label="yes"];
    "Tasks mostly independent?" -> "Manual execution or brainstorm first" [label="no - tightly coupled"];
    "Stay in this session?" -> "subagent-driven-development" [label="yes"];
    "Stay in this session?" -> "executing-plans" [label="no - parallel session"];
}
```

**vs. Executing Plans (parallel session):**
- Same session (no context switch)
- Fresh subagent per task (no context pollution)
- Two-stage review after each task: Quality+Spec first, then Critical/Safety
- Faster iteration (no human-in-loop between tasks)

**Dependent tasks:** Most real plans have some dependencies. For dependent tasks, include the previous task's implementation summary and relevant file paths in the next subagent's context. Track what each completed task produced so you can pass it forward.

## Model Selection

Choose model capability deliberately:

- **Mechanical implementation tasks** (small, localized, complete spec) → cheaper model is fine
- **Integration or debugging tasks** (multiple files, coordination, pattern matching) → standard model
- **Architecture, planning, or review-heavy tasks** → most capable model available

If an implementer gets stuck for capability reasons, re-dispatch with a more capable model instead of blindly retrying.

## The Process

```dot
digraph process {
    rankdir=TB;

    subgraph cluster_per_task {
        label="Per Task";
        "Dispatch implementer subagent (./implementer-prompt.md)" [shape=box];
        "Implementer subagent asks questions?" [shape=diamond];
        "Answer questions, provide context" [shape=box];
        "Implementer subagent implements, tests, commits" [shape=box];
        "Dispatch Quality+Spec Reviewer (./quality-spec-reviewer-prompt.md)" [shape=box];
        "Quality+Spec reviewer approves?" [shape=diamond];
        "Implementer subagent fixes issues" [shape=box];
        "Dispatch Critical/Safety Reviewer (./critical-reviewer-prompt.md)" [shape=box];
        "Critical reviewer approves?" [shape=diamond];
        "Assess fix complexity (action matrix)" [shape=diamond];
        "Orchestrator fixes directly" [shape=box];
        "Re-dispatch implementer" [shape=box];
        "Orchestrator cross-references" [shape=box];
        "Flags present?" [shape=diamond];
        "Orchestrator reviews flagged files" [shape=box];
        "Issues found?" [shape=diamond];
        "Mark task complete via plan_tracker tool" [shape=box];
    }

    "Dispatch implementer subagent (./implementer-prompt.md)" -> "Implementer subagent asks questions?";
    "Implementer subagent asks questions?" -> "Answer questions, provide context" [label="yes"];
    "Answer questions, provide context" -> "Dispatch implementer subagent (./implementer-prompt.md)";
    "Implementer subagent asks questions?" -> "Implementer subagent implements, tests, commits" [label="no"];
    "Implementer subagent implements, tests, commits" -> "Dispatch Quality+Spec Reviewer (./quality-spec-reviewer-prompt.md)";
    "Dispatch Quality+Spec Reviewer (./quality-spec-reviewer-prompt.md)" -> "Quality+Spec reviewer approves?";
    "Quality+Spec reviewer approves?" -> "Implementer subagent fixes issues" [label="no"];
    "Implementer subagent fixes issues" -> "Dispatch Quality+Spec Reviewer (./quality-spec-reviewer-prompt.md)" [label="re-review"];
    "Quality+Spec reviewer approves?" -> "Dispatch Critical/Safety Reviewer (./critical-reviewer-prompt.md)" [label="yes"];
    "Dispatch Critical/Safety Reviewer (./critical-reviewer-prompt.md)" -> "Critical reviewer approves?";
    "Critical reviewer approves?" -> "Assess fix complexity (action matrix)" [label="no"];
    "Assess fix complexity (action matrix)" -> "Orchestrator fixes directly" [label="simple"];
    "Assess fix complexity (action matrix)" -> "Re-dispatch implementer" [label="complex"];
    "Orchestrator fixes directly" -> "Dispatch Critical/Safety Reviewer (./critical-reviewer-prompt.md)" [label="re-review"];
    "Re-dispatch implementer" -> "Dispatch Quality+Spec Reviewer (./quality-spec-reviewer-prompt.md)" [label="re-review"];
    "Critical reviewer approves?" -> "Orchestrator cross-references" [label="yes"];
    "Orchestrator cross-references" -> "Flags present?";
    "Flags present?" -> "Orchestrator reviews flagged files" [label="yes"];
    "Flags present?" -> "Issues found?" [label="no"];
    "Orchestrator reviews flagged files" -> "Issues found?";
    "Issues found?" -> "Mark task complete via plan_tracker tool" [label="no"];
    "Issues found?" -> "Assess fix complexity (action matrix)" [label="yes"];
}
```

### Orchestrator Review

After Critical/Safety reviewer approves, the orchestrator **always** performs a final review before marking the task complete.

**What the orchestrator reviews:**
1. Read the Review Summary from critical-reviewer
2. **Always** cross-reference mentally with:
   - Previous tasks' implementation summaries (what patterns were established)
   - Upcoming tasks in the plan (does this implementation help or hinder them)
   - Global project context (naming conventions, architectural decisions)
3. If **Flags for orchestrator** is not "none", open those specific files for detailed review

**What the orchestrator checks:**
- Consistency with previous tasks (naming, patterns, structure)
- Side effects on completed work
- Readiness for upcoming tasks
- Business context alignment

**Important:** Flags are hints for which files need detailed review, NOT a gate for whether to review. The orchestrator always does the mental cross-reference — this is the core value of this step.

**How the orchestrator acts:**

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

### Action Matrix for Critical Reviewer Problems

When the Critical/Safety reviewer finds issues, use this matrix to decide who fixes:

| Problem type | Action |
|--------------|--------|
| Implementation debris (console.log, etc) | Orchestrator removes directly |
| Unused import | Orchestrator removes directly |
| Simple security risk | Orchestrator fixes if obvious, otherwise re-dispatch |
| Side effect in dependency | Re-dispatch implementer with context |
| Complex technical risk | Re-dispatch implementer with context |
| Architectural problem | Escalate to user |

#### Re-dispatch Context

When re-dispatching implementer after finding issues, include:
1. The specific flag that triggered the review
2. The orchestrator's analysis of the issue
3. The required fix
4. Relevant file paths

**Loop prevention:**

Orchestrator-initiated re-dispatches are subject to the same "2 attempts" limit as regular failures. After 2 failed fix attempts:
- Minor issue → Log it, mark task complete, note in final report
- Blocking issue → Escalate to user with full context

#### Edge Case: Missing or Malformed Review Summary

If the Critical/Safety reviewer doesn't produce a Review Summary:
1. Re-dispatch reviewer with format reminder
2. If still missing, fall back to `git diff HEAD~1` and proceed with review

Fallback review outcomes follow the same action matrix.

## Prompt Templates

- `./implementer-prompt.md` - Dispatch implementer subagent
- `./quality-spec-reviewer-prompt.md` - Dispatch Quality+Spec reviewer subagent
- `./critical-reviewer-prompt.md` - Dispatch Critical/Safety reviewer subagent

**How to dispatch:**

Use the `subagent` tool directly with the template text filled in:

```ts
subagent({
  agent: "implementer",
  taskKey: "task-2",
  workstreamMode: "auto",
  task: "... full implementer prompt text ..."
})
```

```ts
subagent({ agent: "quality-spec-reviewer", agentScope: "both", task: "... full quality+spec review prompt text ..." })
```

```ts
subagent({ agent: "critical-reviewer", agentScope: "both", task: "... full critical/safety review prompt text ..." })
```

For implementer dispatches, always pass a stable `taskKey` for the current plan task. Use the same `taskKey` for follow-up fixes inside that task so the implementer workstream can retain task-local context.

If the active implementer has accumulated bad context for the same task, rotate it explicitly:

```ts
subagent({
  agent: "implementer",
  taskKey: "task-2",
  workstreamMode: "rotate",
  rotationReason: "scope drift after reviewer feedback",
  task: "... full implementer prompt text ..."
})
```

## Handling Implementer Status

Implementer subagents report one of four statuses. Handle them explicitly:

- **`DONE`** — proceed to Quality+Spec review
- **`DONE_WITH_CONCERNS`** — read the concerns before proceeding; if they affect correctness or scope, address them first
- **`NEEDS_CONTEXT`** — provide the missing context and re-dispatch
- **`BLOCKED`** — change something before retrying: provide more context, use a stronger model, split the task, or escalate to the user

Never ignore an escalation and never force the same retry without changing the conditions.

## Example Workflow

```
You: I'm using Subagent-Driven Development to execute this plan.

[Read plan file once: docs/plans/feature-plan.md]
[Extract all 5 tasks with full text and context]
[Initialize plan_tracker tool with all tasks]

Task 1: Hook installation script

[Get Task 1 text and context (already extracted)]
[Dispatch implementation subagent with full task text + context]

Implementer: "Before I begin - should the hook be installed at user or system level?"

You: "User level (~/.config/superpowers/hooks/)"

Implementer: "Got it. Implementing now..."
[Later] Implementer:
  - Implemented install-hook command
  - Added tests, 5/5 passing
  - Self-review: Found I missed --force flag, added it
  - Committed

[Dispatch Quality+Spec reviewer]
Quality+Spec reviewer: 
  - Spec compliance: ✅ Full
  - Code quality: Clean, good test coverage
  - Approved.

[Get git SHAs, dispatch Critical/Safety reviewer]
Critical reviewer:
  - Affected dependents: none identified
  - Flags for orchestrator: shared config module (new dependency)
  - Side effect risk: None
  - Security risks: none
  - Debris: none
  - Approved.

[Orchestrator review]
  - Reads Review Summary
  - Flag present: opens shared config module
  - Checks: change is additive, no breaking changes
  - Cross-reference: next task needs config read, this prepares well
  - No issues found

[Mark Task 1 complete]

Task 2: Recovery modes

[Get Task 2 text and context (already extracted)]
[Dispatch implementation subagent with full task text + context]

Implementer: [No questions, proceeds]
Implementer:
  - Added verify/repair modes
  - 8/8 tests passing
  - Self-review: All good
  - Committed

[Dispatch Quality+Spec reviewer]
Quality+Spec reviewer: ❌ Issues:
  - Spec compliance: ⚠️ Partial
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)

[Implementer fixes issues]
Implementer: Removed --json flag, added progress reporting

[Quality+Spec reviewer reviews again]
Quality+Spec reviewer: ✅ Spec compliance: Full. Approved.

[Dispatch Critical/Safety reviewer]
Critical reviewer:
  - Affected dependents: `src/cli.ts` imports `verifyMode()` which now has new param
  - Side effect risk: Medium - cli.ts needs update
  - Action: Re-dispatch implementer

[Re-dispatch implementer with context]
Implementer: Updated cli.ts to pass new param to verifyMode()

[Quality+Spec reviewer]
Quality+Spec reviewer: ✅ Approved

[Critical/Safety reviewer]
Critical reviewer:
  - Affected dependents: none identified (all updated)
  - Side effect risk: None
  - Approved.

[Orchestrator review]
  - Reads Review Summary
  - No flags
  - Cross-reference: naming consistent with Task 1
  - No issues found

[Mark Task 2 complete]

...

[After all tasks complete]

Done! Use /skill:finishing-a-development-branch for final integration.
```

## Red Flags

**Never:**
- Start implementation on main/master branch without explicit user consent
- Skip reviews (Quality+Spec OR Critical/Safety)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make subagent read plan file (provide full text instead)
- Skip scene-setting context (subagent needs to understand where task fits)
- Ignore subagent questions (answer before letting them proceed)
- Accept "close enough" on spec compliance (Quality+Spec reviewer found issues = not done)
- Skip review loops (reviewer found issues = implementer fixes = review again)
- Let implementer self-review replace actual review (both are needed)
- Skip orchestrator review when flags are present (read the summary, check flagged files)
- **Start Critical/Safety review before Quality+Spec is ✅** (wrong order)
- Move to next task while either review has open issues
- Ignore `DONE_WITH_CONCERNS`, `BLOCKED`, or `NEEDS_CONTEXT`
- **Skip Critical/Safety review after Quality+Spec passes**
- **Ignore "Affected dependents" from Critical/Safety reviewer**
- **Accept implementation debris (console.log, var_dump, etc) without flagging**
- **Ignore security risks identified by Critical/Safety reviewer**

**If subagent asks questions:**
- Answer clearly and completely
- Provide additional context if needed
- Don't rush them into implementation

**If reviewer finds issues:**
- Implementer (same subagent) fixes them
- Reviewer reviews again
- Repeat until approved
- Don't skip the re-review

**If subagent fails task:**
- See **"When a Subagent Fails"** below — never code directly, always re-dispatch or escalate

## When a Subagent Fails

**You are the orchestrator. You do NOT write code. You dispatch subagents that write code.**

If an implementer subagent fails, errors out, or returns `BLOCKED` / `NEEDS_CONTEXT` / incomplete work:

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

## After All Tasks Complete

When all tasks are done and reviewed, **stop and report to the user**:

1. Summarize what was implemented (tasks completed, files changed, test counts)
2. Ask: "All tasks complete. Ready for final review and finishing?"
3. **Wait for user confirmation before proceeding**

Do NOT automatically dispatch final review or start the finishing skill. The user may want to test manually, adjust scope, or take a break before the final phase.

## Integration

**Required workflow skills:**
- **`/skill:using-git-worktrees`** - Recommended: Set up isolated workspace before starting. For small changes, branching in the current directory is acceptable with human approval.
- **`/skill:writing-plans`** - Creates the plan this skill executes
- **`/skill:requesting-code-review`** - Code review template for reviewer subagents
- **`/skill:finishing-a-development-branch`** - Complete development after all tasks

**Subagents follow by default:**
- **TDD** - Runtime warnings on source-before-test patterns. Implementer subagents receive three-scenario TDD instructions via agent profile and prompt template: new feature (full TDD), modifying tested code (run existing tests), trivial change (judgment call).

**Alternative workflow:**
- **`/skill:executing-plans`** - Use for parallel session instead of same-session execution
