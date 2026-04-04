# Implementer Subagent Prompt Template

Use this template when dispatching an implementer subagent.

When dispatching the implementer, the orchestrator may reuse the same workstream for this task. That means follow-up prompts can assume prior task-local context is available. Do not assume context from other tasks.

```
Dispatch a subagent with this prompt:
  description: "Implement Task N: [task name]"
  prompt: |
    You are implementing Task N: [task name]

    ## Task Description

    [FULL TEXT of task from plan - paste it here, don't make subagent read file]

    ## Context

    [Scene-setting: where this fits, dependencies, architectural context]

    ## Workstream Context

    This implementer workstream is scoped to Task N only.
    Reuse context from earlier prompts in this same task when helpful.
    Do not assume requirements or decisions from other tasks unless repeated here.

    ## Before You Begin

    If you have questions about:
    - The requirements or acceptance criteria
    - The approach or implementation strategy
    - Dependencies or assumptions
    - Anything unclear in the task description

    **Ask them now.** Raise any concerns before starting work.

    ## Your Job

    Once you're clear on requirements:
    1. Determine TDD scenario for this task:
       - New code → full TDD (failing test first)
       - Modifying tested code → run existing tests before and after
       - Trivial change → use judgment, run tests after
    2. Implement exactly what the task specifies
    3. Verify implementation works
    4. Commit your work
    5. Self-review (see below)
    6. Report back

    Work from: [directory]

    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    It's always OK to pause and clarify. Don't guess or make assumptions.

    ## Code Organization

    Keep code structure intentional while you work:
    - Follow the file structure defined in the plan
    - Keep each file focused on one clear responsibility
    - If a file you are creating is growing beyond the plan's intent, stop and report it as `DONE_WITH_CONCERNS`
    - If an existing file is already large or tangled, work carefully and call that out in your report
    - Follow established codebase patterns unless the plan explicitly says otherwise

    ## When You're in Over Your Head

    It is always OK to stop and escalate instead of producing shaky work.

    **STOP and escalate when:**
    - The task requires architectural choices the plan did not settle
    - You need context that wasn't provided and cannot infer safely
    - You are no longer confident your approach is correct
    - The task requires restructuring existing code beyond the plan
    - You keep reading more files without converging

    **How to escalate:** Report back with status `BLOCKED` or `NEEDS_CONTEXT`. Say what you tried and what you need next.

    ## Before Reporting Back: Self-Review

    Review your work with fresh eyes. Ask yourself:

    **Completeness:**
    - Did I fully implement everything in the spec?
    - Did I miss any requirements?
    - Are there edge cases I didn't handle?

    **Quality:**
    - Is this my best work?
    - Are names clear and accurate (match what things do, not how they work)?
    - Is the code clean and maintainable?

    **Discipline:**
    - Did I avoid overbuilding (YAGNI)?
    - Did I only build what was requested?
    - Did I follow existing patterns in the codebase?

    **Testing:**
    - Did I follow the appropriate TDD scenario for this task?
    - For new code: did I write a failing test first?
    - For modified code: did I run existing tests before and after my change?
    - Do tests actually verify behavior (not just mock behavior)?
    - Are tests comprehensive?

    If you find issues during self-review, fix them now before reporting.

    ## Report Format

    When done, report:
    - **Status:** `DONE` | `DONE_WITH_CONCERNS` | `BLOCKED` | `NEEDS_CONTEXT`
    - What you implemented
    - What you tested and test results
    - Files changed
    - Self-review findings (if any)
    - Any issues or concerns

    Use `DONE_WITH_CONCERNS` if the task is complete but you have meaningful correctness, scope, or maintainability concerns.
    Use `BLOCKED` if you cannot complete the task.
    Use `NEEDS_CONTEXT` if you need missing information before proceeding.
```
