# Changelog

All notable changes to pi-superpowers-plus are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Two-stage review agents** — `quality-spec-reviewer` and `critical-reviewer` bundled agents for the new two-stage review system (quality+spec first, then critical/safety).
- **Spec document review prompts** — `brainstorming` now ships a bundled `spec-document-reviewer-prompt.md` and instructs the agent to run a review loop before handing off to planning.
- **Plan document review prompts** — `writing-plans` now ships a bundled `plan-document-reviewer-prompt.md` for chunk-level plan review before execution.
- **Managed pi-subagents agent sync** — `extensions/pi-subagents-agent-sync.ts` now installs bundled `spx-*` agent definitions into Pi's user agent directory automatically.

### Changed

- **`brainstorming` skill synced with upstream 5.x structure** — adds hard gate/checklist discipline, scope decomposition, design-for-isolation guidance, spec review loop, and explicit user approval of the written spec while preserving Pi-specific `docs/plans/` and `plan_tracker` behavior.
- **`writing-plans` simplified plan review** — removido o loop de review com subagente (`doc-reviewer`) e chunks de 1000 linhas. Substituído por: (1) seção "No Placeholders" com red flags explícitos e (2) checklist de Self-Review inline (cobertura da spec, scan de placeholders, consistência de tipos). Alinhado ao upstream v5.0.4 + v5.0.6 — qualidade equivalente, sem overhead de latência.
- **`writing-plans` skill synced with upstream 5.x planning guidance** — adds scope checks, file-structure planning, checkbox task syntax, and plan review loops while keeping Pi-specific execution handoff.
- **Subagent orchestration strengthened** — `subagent-driven-development`, implementer prompts, and bundled agent profiles now use the new escalation/status protocol and architecture-aware review criteria.
- **Subagent runtime migrated to upstream `pi-subagents`** — this package now depends on `pi-subagents`, activates its entrypoints from `node_modules`, ships namespaced `spx-*` workflow agents, and validates structured-agent output at the prompt/orchestrator layer rather than through local runtime fields.

### Removed

- **`tdd-guard` extension** — TDD enforcement is now handled via runtime warnings in `workflow-monitor` and three-scenario TDD instructions embedded in agent profiles and skill text. Agent profiles no longer need `extensions: ../extensions/tdd-guard.ts` in their frontmatter.
- **`spec-reviewer` agent** — replaced by the two-stage review system (`quality-spec-reviewer` + `critical-reviewer`).
- **Bundled local subagent runtime** — `extensions/subagent/` and its runtime-coupled tests have been removed in favor of upstream `pi-subagents`.

---

## [0.3.0] — 2026-02-18

### Summary

Hardening and skill boundary enforcement. Security fixes, resilient subagent lifecycle, and fixes for three behavioral gaps where the agent ignores skill boundaries.

### Security

- **Environment variable filtering** — subagent spawn now uses an allowlist instead of `{ ...process.env }`. Only safe vars (PATH, HOME, SHELL, NODE_*, PI_*, etc.) are forwarded. Secrets like API keys, database URLs, and cloud credentials are no longer leaked to subagent processes.
- **`PI_SUBAGENT_ENV_PASSTHROUGH`** — escape hatch for users who need to forward specific vars (comma-separated names).
- **CWD validation** — subagent spawn now validates the working directory exists before spawning, returning a clear error instead of a cryptic ENOENT.

### Added

- **Configurable subagent timeout** (`PI_SUBAGENT_TIMEOUT_MS`, default 10 min) — absolute timeout that kills subagents regardless of activity. Agent definitions can override via `timeout` field.
- **Cancellation propagation** — active subagent processes are tracked and killed (SIGTERM → SIGKILL) when the parent session exits.
- **Concurrent subagent cap** (`PI_SUBAGENT_CONCURRENCY`, default 6) — semaphore-based limit on parallel subagent spawns. When the cap is hit, new invocations queue until a slot opens.

### Fixed

- **SDD orchestrator codes on subagent failure** — Promoted subagent failure handling from buried bullet points to a gated section with hard rules. Explicit: the orchestrator does NOT write code, only dispatches subagents. 2 failed attempts = stop and escalate to user.
- **Review subagents apply fixes** — Added explicit read-only `## Boundaries` sections to `code-reviewer.md`. Reviewers produce written reports — they never touch code.
- **SDD auto-finishes without asking** — Added user checkpoint after all tasks complete. Orchestrator must summarize results and wait for user confirmation before dispatching final review or starting the finishing skill.
- Silent catch blocks in workflow-monitor now log warnings via `log.warn` instead of silently swallowing failures (state file read/write errors).

### Changed

- **Package version** bumped to `0.3.0`.

---

## [0.2.0-alpha.1] — 2026-02-13

### Summary

First-class subagent support. Skills now dispatch implementation and review work via a bundled `subagent` tool instead of shell commands. Four default agent definitions ship with the package. The workflow monitor and TDD enforcement both received important correctness fixes.

### Added

- **Subagent extension** (`extensions/subagent/`) — vendored from pi's example extension. Registers a `subagent` tool that spawns isolated pi subprocesses for implementation and review tasks. Supports single-agent and parallel (multi-task) modes.
- **Agent definitions** (`agents/`) — bundled agent profiles:
  - `implementer` — strict TDD implementation with the tdd-guard extension
  - `worker` — general-purpose task execution
  - `code-reviewer` — production readiness review (read-only)
  - `doc-reviewer` — spec/plan document review (read-only)
- **Agent frontmatter `extensions` field** — agent `.md` files can declare extensions (e.g. `extensions: ../extensions/tdd-guard.ts`), which are resolved and passed as `--extension` flags to the subprocess.
- **TDD guard extension** (`extensions/tdd-guard.ts`) — lightweight TDD enforcement designed for subagents. Blocks production file writes until a passing test run is observed. Tracks violations via `PI_TDD_GUARD_VIOLATIONS_FILE` env var. Exits after 3 consecutive blocked writes.
- **Structured subagent results** — single-agent mode returns `filesChanged`, `testsRan`, `tddViolations`, `agent`, `task`, and `status` fields in tool result details.
- **Shared test helpers** (`tests/extension/workflow-monitor/test-helpers.ts`) — `createFakePi()`, `getSingleHandler()`, `getHandlers()` extracted and shared across all workflow-monitor test files.
- **`parseSkillName()` utility** (`extensions/workflow-monitor/workflow-tracker.ts`) — centralized `/skill:name` and `<skill name="...">` extraction, replacing duplicated regexes.

### Fixed

- **Input event text field** — Workflow monitor now reads `event.text` (primary) with fallback to `event.input` for skill detection in user input. Previously only checked `event.input`, missing skills delivered via the `text` field.
- **Completion gate phase scoping** — Interactive commit/push/PR prompts now only fire during execute+ phases. Previously they could fire during brainstorm/plan, interrupting early-phase work (e.g. committing a design doc).
- **docs/plans allowlist path traversal** — The brainstorm/plan write allowlist now resolves paths against `process.cwd()` and requires the resolved path to be under `${cwd}/docs/plans/`. Previously, an absolute path like `/tmp/evil/docs/plans/attack.ts` would pass the substring check.
- **TDD guard pass/fail semantics** — The tdd-guard extension now requires a *passing* test result (exit code 0) to unlock production writes. Previously, any test command execution — including failures — would unlock writes.

### Changed

- **Skills updated for subagent dispatch** — `subagent-driven-development`, `dispatching-parallel-agents`, and `requesting-code-review` skills now show `subagent()` tool call examples instead of `pi -p` shell commands.
- **Package version** bumped to `0.2.0-alpha.1`.
- **`package.json` `files`** now includes `agents/` directory.
- **`package.json` `pi.extensions`** now includes `extensions/subagent/index.ts`.

### Internal

- Deduplicated ~180 lines of test helper boilerplate across 6 workflow-monitor test files.
- Added 8 new test files (67 new tests) covering subagent discovery, frontmatter extensions, structured results, tdd-guard behavior, completion gate phasing, path traversal, and input event handling.
- Total test count: **29 files, 251 tests**.

---

## [0.1.0-alpha.3] — 2026-02-12

### Summary

Warning escalation guardrails, branch safety, workflow tracking with phase boundaries, and the initial release of active enforcement extensions.

### Added

- Workflow Monitor extension with TDD, debug, and verification enforcement
- Plan Tracker extension with TUI widget
- 12 workflow skills ported and trimmed from pi-superpowers
- Branch safety notices (current branch on first tool result, confirm-branch on first write)
- Workflow phase tracking with boundary prompts and `/workflow-next` command
- Warning escalation: soft → hard block → user override
- `workflow_reference` tool for on-demand TDD/debug reference content

---

## [0.1.0-alpha.1] — 2026-02-10

Initial alpha release. Skills only, no extensions.
