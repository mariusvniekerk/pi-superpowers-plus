# Codex/GPT Support Agents Implementation Plan

> **For agentic workers:** REQUIRED: Use `/skill:orchestrator-implements` (in-session, orchestrator implements), `/skill:subagent-driven-development` (in-session, subagents implement), or `/skill:executing-plans` (parallel session) to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** Add bundled support agents inspired by Hyperpowers for repository investigation, internet research, focused test execution, and test-audit work, with cheap routing for routine utility roles.

**Architecture:** This change is configuration-first. The subagent runtime already discovers bundled markdown agent definitions from `agents/`. We will add new bundled agent files, add tests that verify discovery and model routing, and update README documentation to expose the new agents and their intended usage.

**Tech Stack:** TypeScript, Vitest, markdown agent frontmatter, pi subagent discovery.

---

## File Structure

- New bundled agent definitions under `agents/`
- Test coverage in `tests/extension/subagent/agents-discovery.test.ts` and `tests/skills/workflow-skill-content.test.ts`
- README updates in `README.md`

### Task 1: Add failing discovery/model-routing tests

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Modify: `tests/extension/subagent/agents-discovery.test.ts`
- Modify: `tests/skills/workflow-skill-content.test.ts`

- [ ] **Step 1: Run the existing targeted tests to confirm green**

Run: `npm test -- tests/extension/subagent/agents-discovery.test.ts tests/skills/workflow-skill-content.test.ts`
Expected: PASS

- [ ] **Step 2: Add assertions for the new bundled agents**

Add checks that discovery includes:
- `codebase-investigator`
- `internet-researcher`
- `test-runner`
- `test-effectiveness-analyst`

Add checks that:
- `test-runner` has `tools: ["bash"]`
- `test-runner` uses `openai-codex/gpt-5.4:low`
- `internet-researcher` uses a low-cost routing tier

- [ ] **Step 3: Run the targeted tests to verify they fail**

Run: `npm test -- tests/extension/subagent/agents-discovery.test.ts tests/skills/workflow-skill-content.test.ts`
Expected: FAIL because the new bundled agents do not exist yet

- [ ] **Step 4: Commit the failing tests**

```bash
git add tests/extension/subagent/agents-discovery.test.ts tests/skills/workflow-skill-content.test.ts
git commit -m "test(subagent): require support agent discovery"
```

### Task 2: Add bundled support agent definitions

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Create: `agents/codebase-investigator.md`
- Create: `agents/internet-researcher.md`
- Create: `agents/test-runner.md`
- Create: `agents/test-effectiveness-analyst.md`

- [ ] **Step 1: Create `agents/codebase-investigator.md`**

Include frontmatter with:
- `name: codebase-investigator`
- concise description
- `tools: read, bash, find, grep, ls, lsp`
- `model: openai-codex/gpt-5.4:low`

Prompt must require:
- verified file-path answers
- evidence with file paths / line refs when possible
- concise structured output
- use of `lsp` when symbol-aware navigation matters

- [ ] **Step 2: Create `agents/internet-researcher.md`**

Include frontmatter with:
- `name: internet-researcher`
- `tools: web_search, read`
- `model: openai-codex/gpt-5.4:low`

Prompt must require:
- official docs first
- current-version awareness
- concise sourced answer
- explicit uncertainty when sources conflict

- [ ] **Step 3: Create `agents/test-runner.md`**

Include frontmatter with:
- `name: test-runner`
- `tools: bash`
- `model: openai-codex/gpt-5.4:low`

Prompt must require:
- executing exactly the provided command
- returning only summary + failures
- no speculative diagnosis unless requested
- preserving complete failure details when the command fails

- [ ] **Step 4: Create `agents/test-effectiveness-analyst.md`**

Include frontmatter with:
- `name: test-effectiveness-analyst`
- read-only analysis tools such as `read, find, grep, ls, lsp`
- `model: openai-codex/gpt-5.4:high`

Prompt must require:
- reading both tests and production code
- identifying weak assertions / tautologies / untested edge cases
- structured severity-based output

- [ ] **Step 5: Run the targeted tests to verify they pass**

Run: `npm test -- tests/extension/subagent/agents-discovery.test.ts tests/skills/workflow-skill-content.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the agent definitions**

```bash
git add agents/codebase-investigator.md agents/internet-researcher.md agents/test-runner.md agents/test-effectiveness-analyst.md tests/extension/subagent/agents-discovery.test.ts tests/skills/workflow-skill-content.test.ts
git commit -m "feat(subagent): add bundled support agents"
```

### Task 3: Document the bundled support agents

**TDD scenario:** Trivial change — use judgment

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the bundled agent table**

Add rows for the four new agents with purpose, tools, and intended usage.

- [ ] **Step 2: Document model-routing intent**

Add a short note that utility roles like `test-runner` use low thinking tiers, while implementation/review roles stay on higher tiers.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit the documentation update**

```bash
git add README.md
git commit -m "docs: describe bundled support agents"
```
