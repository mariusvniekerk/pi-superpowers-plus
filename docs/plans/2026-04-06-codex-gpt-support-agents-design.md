# Codex/GPT Support Agents Design

**Date:** 2026-04-06
**Status:** Approved in-session by user direction to proceed

## Context

`withzombies/hyperpowers` adds several utility subagents beyond stock `obra/superpowers`: codebase investigation, internet research, focused test execution, and test effectiveness review. `pi-superpowers-plus` already ships implementation and review agents, but it lacks low-cost utility agents that are especially useful in Codex/GPT workflows.

## Goal

Add bundled support agents that:
- reduce orchestration context bloat
- route routine work to cheaper thinking tiers
- improve evidence quality during planning, debugging, and verification
- preserve the current review/implementation workflow without replacing it

## Approaches Considered

### Option 1: Port Hyperpowers agents nearly verbatim
- **Pros:** fastest, obvious provenance
- **Cons:** prompts are tuned for Claude-style workflows, longer than needed, and not explicit enough about pi/Codex tools

### Option 2: Add pi-native equivalents with Codex/GPT-oriented prompts
- **Pros:** better tool specificity, shorter prompts, cleaner structured outputs, better model routing
- **Cons:** slightly more design effort

### Option 3: Only add model routing guidance, no new bundled agents
- **Pros:** smallest change
- **Cons:** does not actually give users new reusable support agents

## Recommendation

Use **Option 2**.

Add Hyperpowers-inspired bundled agents, but rewrite them for pi/Codex/GPT usage.

## Selected Agent Set

### 1. `codebase-investigator`
Purpose: verify repository facts, existing patterns, file ownership, and dependency paths.

**Tools:** `read`, `find`, `grep`, `ls`, `lsp`, `bash`

**Model:** `openai-codex/gpt-5.4:low`

### 2. `internet-researcher`
Purpose: gather current external documentation, release info, migration guidance, and best practices.

**Tools:** `web_search`, `read`

**Model:** `openai-codex/gpt-5.4:low`

### 3. `test-runner`
Purpose: execute tests or other noisy verification commands and return a compact summary.

**Tools:** `bash`

**Model:** `openai-codex/gpt-5.4:low`

### 4. `test-effectiveness-analyst`
Purpose: audit whether tests provide real confidence versus superficial coverage.

**Tools:** `read`, `find`, `grep`, `ls`, `lsp`

**Model:** `openai-codex/gpt-5.4:high`

## Non-Goals

- no changes to subagent runtime behavior
- no automatic dispatch of the new agents yet
- no replacement of existing reviewer/implementer roles
- no attempt to build generic task routers in this change

## Documentation Impact

Update README bundled-agent documentation to include the new agents and describe the intended low-cost routing for utility roles.

## Testing Strategy

1. Add discovery tests that assert the new bundled agents are present.
2. Assert key model routing choices, especially that `test-runner` uses a low thinking tier.
3. Run the targeted test file, then the full test suite.
