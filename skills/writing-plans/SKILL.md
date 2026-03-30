---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

> **Related skills:** Did you `/skill:brainstorming` first? Ready to implement? Use `/skill:orchestrator-implements`, `/skill:subagent-driven-development`, or `/skill:executing-plans`.

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** This should be run in a dedicated worktree (created by brainstorming skill).

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`

## Boundaries
- Read code and docs: yes
- Write to docs/plans/: yes
- Edit or create any other files: no

## Scope Check

If the spec covers multiple independent subsystems, it should have been decomposed during brainstorming. If it was not, stop and suggest separate plans rather than forcing one oversized implementation plan.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for.

- Prefer small, focused files with one clear responsibility
- Split by responsibility, not by technical layer alone
- In existing codebases, follow established patterns unless a targeted split is necessary to keep the task understandable
- If a plan would create or significantly grow a file that is already hard to reason about, address that directly in the plan

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED: Use `/skill:orchestrator-implements` (in-session, orchestrator implements), `/skill:subagent-driven-development` (in-session, subagents implement), or `/skill:executing-plans` (parallel session) to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Task Structure

```markdown
### Task N: [Component Name]

**TDD scenario:** [New feature — full TDD cycle | Modifying tested code — run existing tests first | Trivial change — use judgment]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
```

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- Reference relevant skills
- DRY, YAGNI, TDD, frequent commits
- Order tasks so each task's dependencies are completed by earlier tasks
- If plan exceeds ~8 tasks, consider splitting into phases with a checkpoint between them

## Self-Review

Depois de escrever o plano completo, olhe para a spec com olhos frescos e revise o plano contra ela. Este é um checklist que você mesmo executa — não um dispatch de subagente.

**1. Cobertura da spec:** Percorra cada seção/requisito da spec. Você consegue apontar uma task que o implementa? Liste as lacunas.

**2. Scan de placeholders:** Procure no plano por red flags — qualquer um dos padrões da seção "No Placeholders" acima. Corrija-os.

**3. Consistência de tipos:** Os tipos, assinaturas de métodos e nomes de propriedades usados em tasks posteriores batem com o que você definiu em tasks anteriores? Uma função chamada `clearLayers()` na Task 3 mas `clearFullLayers()` na Task 7 é um bug.

Se encontrar problemas, corrija inline. Não é necessário re-revisar — apenas corrija e siga em frente. Se encontrar um requisito da spec sem task correspondente, adicione a task.

## Execution Handoff

After saving the plan, mark the planning phase complete: call `plan_tracker` with `{action: "update", status: "complete"}` for the current phase.

Then offer execution choice:

**"Plan complete and saved to `docs/plans/<filename>.md`. Three execution options:**

**1. Orchestrator Implements (this session)** - Main LLM implements directly, subagent reviewers check quality. Best for plans that fit in context. Autonomous after start. Economical.

**2. Subagent-Driven (this session)** - Fresh subagent per task with two-stage review. Better for complex plans where implementation benefits from isolated context.

**3. Parallel Session (separate)** - Batch execution with human review checkpoints. Better when tasks are tightly coupled or you want more control between batches.

**Which approach?"**

**If Orchestrator Implements chosen:**
- **REQUIRED SUB-SKILL:** Use `/skill:orchestrator-implements`
- Stay in this session
- Orchestrator implements + subagent reviewers

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use `/skill:subagent-driven-development`
- Stay in this session
- Fresh subagent per task + code review

**If Parallel Session chosen:**
- Guide them to open new session in worktree
- **REQUIRED SUB-SKILL:** New session uses `/skill:executing-plans`
