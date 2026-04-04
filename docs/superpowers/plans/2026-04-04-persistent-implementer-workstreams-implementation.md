# Persistent Implementer Workstreams Implementation Plan

> **For agentic workers:** REQUIRED: Use `/skill:orchestrator-implements` (in-session, orchestrator implements), `/skill:subagent-driven-development` (in-session, subagents implement), or `/skill:executing-plans` (parallel session) to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** Add task-scoped persistent implementer workstreams so follow-up implementation rounds can reuse context inside a task while reviewer runs stay fresh and isolated.

**Architecture:** Keep the current subprocess path for reviewer-style isolated runs, but add an in-process implementer runtime backed by Pi SDK `AgentSession`s plus a persisted workstream registry. Route `implementer` requests through that runtime when the orchestrator provides a stable `taskKey`, and reconstruct registry state on session transitions so the active workstream survives `new`, `resume`, and `fork` logically.

**Tech Stack:** TypeScript, Vitest, Pi extension API (`@mariozechner/pi-coding-agent`), Pi SDK session primitives, TypeBox

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `extensions/subagent/runtime-types.ts` | Create | Shared result/status/workstream types used by runtimes and `index.ts` |
| `extensions/subagent/subprocess-runtime.ts` | Create | Reviewer/fresh-process execution path extracted from `index.ts` |
| `extensions/subagent/workstreams.ts` | Create | Workstream registry, selection policy, and status helpers |
| `extensions/subagent/persistence.ts` | Create | Persist and restore workstream metadata through extension entries |
| `extensions/subagent/implementer-runtime.ts` | Create | In-process Pi SDK runtime for persistent implementer sessions |
| `extensions/subagent/index.ts` | Modify | Tool schema, routing, session lifecycle hooks, and status updates |
| `skills/subagent-driven-development/SKILL.md` | Modify | Instruct orchestrator to pass stable `taskKey` and request rotation explicitly |
| `skills/subagent-driven-development/implementer-prompt.md` | Modify | Document `taskKey` / rotation usage in implementer dispatch |
| `README.md` | Modify | Explain persistent implementers vs fresh reviewers |
| `tests/extension/subagent/subprocess-runtime.test.ts` | Create | Covers extracted reviewer subprocess runner |
| `tests/extension/subagent/workstreams.test.ts` | Create | Covers registry create/reuse/rotate/complete behavior |
| `tests/extension/subagent/persistence.test.ts` | Create | Covers append/restore of persisted workstream metadata |
| `tests/extension/subagent/implementer-runtime.test.ts` | Create | Covers in-process runtime session reuse and result collection |
| `tests/extension/subagent/routing.test.ts` | Create | Covers `subagent` tool routing between implementer/reviewer paths |
| `tests/extension/subagent/session-lifecycle.test.ts` | Create | Covers `session_start` reconstruction and status refresh |

---

### Task 1: Extract Shared Runtime Types And Preserve The Reviewer Runtime

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Create: `extensions/subagent/runtime-types.ts`
- Create: `extensions/subagent/subprocess-runtime.ts`
- Modify: `extensions/subagent/index.ts`
- Modify: `tests/extension/subagent/structured-result.test.ts`
- Create: `tests/extension/subagent/subprocess-runtime.test.ts`

- [ ] **Step 1: Write the failing subprocess runtime tests**

```ts
// tests/extension/subagent/subprocess-runtime.test.ts
import { describe, expect, test, vi } from "vitest";
import { runSubprocessAgent } from "../../../extensions/subagent/subprocess-runtime";

describe("runSubprocessAgent", () => {
  test("returns cwd error before spawn when directory does not exist", async () => {
    const result = await runSubprocessAgent({
      defaultCwd: process.cwd(),
      agent: {
        name: "critical-reviewer",
        source: "project",
        filePath: "/tmp/critical.md",
        systemPrompt: "",
      },
      task: "review diff",
      cwd: "/definitely/missing",
      processTracker: { add() {}, remove() {} } as any,
      semaphore: { active: 0, limit: 1, acquire: async () => () => {} } as any,
    });

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("cwd does not exist");
  });

  test("collects status and file/test summary from assistant messages", async () => {
    const result = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "**Status:** DONE\nImplemented fix" },
            { type: "toolCall", name: "write", arguments: { path: "src/a.ts", content: "x" } },
            { type: "toolCall", name: "bash", arguments: { command: "npx vitest run tests/a.test.ts" } },
          ],
        },
      ],
    } as any;

    const { collectSummary } = await import("../../../extensions/subagent/runtime-types");
    expect(collectSummary(result.messages)).toEqual({
      filesChanged: ["src/a.ts"],
      testsRan: true,
      implementerStatus: "DONE",
    });
  });
});
```

- [ ] **Step 2: Run the focused subagent tests to verify failure**

Run: `npx vitest run tests/extension/subagent/structured-result.test.ts tests/extension/subagent/subprocess-runtime.test.ts`

Expected: FAIL with module-not-found for `extensions/subagent/subprocess-runtime.ts` and missing shared runtime exports.

- [ ] **Step 3: Create shared result/runtime types and move the current subprocess runner**

```ts
// extensions/subagent/runtime-types.ts
import type { Message } from "@mariozechner/pi-ai";

export type ImplementerStatus = "DONE" | "DONE_WITH_CONCERNS" | "BLOCKED" | "NEEDS_CONTEXT";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface SingleResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  tddViolations?: number;
  step?: number;
}

export function parseImplementerStatus(text: string): ImplementerStatus | undefined {
  const match = text.match(/(?:\\*\\*)?Status:(?:\\*\\*)?\\s*(DONE_WITH_CONCERNS|DONE|BLOCKED|NEEDS_CONTEXT)\\b/i);
  return match ? (match[1].toUpperCase() as ImplementerStatus) : undefined;
}

export function collectSummary(messages: Message[]) {
  const files = new Set<string>();
  let testsRan = false;
  let implementerStatus: ImplementerStatus | undefined;

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.content) {
      if (part.type === "text" && !implementerStatus) implementerStatus = parseImplementerStatus(part.text);
      if (part.type === "toolCall" && (part.name === "write" || part.name === "edit")) {
        const filePath = (part.arguments as any)?.path;
        if (typeof filePath === "string") files.add(filePath);
      }
      if (part.type === "toolCall" && part.name === "bash") {
        const command = (part.arguments as any)?.command;
        if (typeof command === "string" && /\\b(vitest|pytest|npm\\s+test|pnpm\\s+test|yarn\\s+test)\\b/.test(command)) {
          testsRan = true;
        }
      }
    }
  }

  return { filesChanged: Array.from(files), testsRan, implementerStatus };
}
```

```ts
// extensions/subagent/subprocess-runtime.ts
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig } from "./agents.js";
import { buildSubagentEnv } from "./env.js";
import { getSubagentTimeoutMs } from "./timeout.js";
import type { SingleResult } from "./runtime-types.js";

export async function runSubprocessAgent(args: {
  defaultCwd: string;
  agent: AgentConfig;
  task: string;
  cwd?: string;
  step?: number;
  signal?: AbortSignal;
  processTracker: { add(proc: any): void; remove(proc: any): void };
  semaphore: { active: number; limit: number; acquire(): Promise<() => void> };
  onMessage?: (message: Message) => void;
}): Promise<SingleResult> {
  const release = await args.semaphore.acquire();
  try {
    const resolvedCwd = path.resolve(args.cwd ?? args.defaultCwd);
    const stat = fs.existsSync(resolvedCwd) ? fs.statSync(resolvedCwd) : undefined;
    if (!stat?.isDirectory()) {
      return {
        agent: args.agent.name,
        agentSource: args.agent.source,
        task: args.task,
        exitCode: 1,
        messages: [],
        stderr: `Subagent cwd does not exist: ${resolvedCwd}`,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
        errorMessage: `Subagent cwd does not exist: ${resolvedCwd}`,
        step: args.step,
      };
    }

    const commandArgs = ["--mode", "json", "-p", "--no-session", `Task: ${args.task}`];
    const proc = spawn("pi", commandArgs, {
      cwd: resolvedCwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildSubagentEnv(),
    });

    args.processTracker.add(proc);
    // Reuse the current buffer / stdout parsing / timeout logic from the existing runSingleAgent()
    // body in extensions/subagent/index.ts unchanged in this task so reviewer behavior does not drift.
  } finally {
    release();
  }
}
```

Use the existing `runSingleAgent()` body from `extensions/subagent/index.ts` as the source of truth for the stdout parser, inactivity timer, absolute timeout, and cleanup logic in this extraction. This task is a behavior-preserving move for reviewer/fresh-process execution.

- [ ] **Step 4: Rewire `extensions/subagent/index.ts` to import the extracted types/runtime**

```ts
// extensions/subagent/index.ts
import { collectSummary, type SingleResult } from "./runtime-types.js";
import { runSubprocessAgent } from "./subprocess-runtime.js";

export const __internal = { collectSummary };

// Replace the old runSingleAgent() body:
const result = await runSubprocessAgent({
  defaultCwd: ctx.cwd,
  agent,
  task,
  cwd,
  step,
  signal,
  processTracker,
  semaphore,
  onMessage: (message) => {
    currentResult.messages.push(message);
    emitUpdate();
  },
});
```

- [ ] **Step 5: Run the extracted-runtime tests again**

Run: `npx vitest run tests/extension/subagent/structured-result.test.ts tests/extension/subagent/subprocess-runtime.test.ts tests/extension/subagent/index-error-handling.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add extensions/subagent/runtime-types.ts extensions/subagent/subprocess-runtime.ts extensions/subagent/index.ts tests/extension/subagent/structured-result.test.ts tests/extension/subagent/subprocess-runtime.test.ts tests/extension/subagent/index-error-handling.test.ts
git commit -m "refactor(subagent): extract reviewer subprocess runtime"
```

### Task 2: Add A Persisted Implementer Workstream Registry

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Create: `extensions/subagent/workstreams.ts`
- Create: `extensions/subagent/persistence.ts`
- Create: `tests/extension/subagent/workstreams.test.ts`
- Create: `tests/extension/subagent/persistence.test.ts`

- [ ] **Step 1: Write failing tests for create/reuse/rotate/complete behavior**

```ts
// tests/extension/subagent/workstreams.test.ts
import { describe, expect, test } from "vitest";
import { ImplementerWorkstreamRegistry } from "../../../extensions/subagent/workstreams";

describe("ImplementerWorkstreamRegistry", () => {
  test("reuses active workstream for same task key", () => {
    const registry = new ImplementerWorkstreamRegistry();
    const first = registry.acquire({
      taskKey: "task-2",
      cwd: "/repo",
      mode: "auto",
    });
    const second = registry.acquire({
      taskKey: "task-2",
      cwd: "/repo",
      mode: "auto",
    });

    expect(second.workstreamId).toBe(first.workstreamId);
    expect(registry.listActive()).toHaveLength(1);
  });

  test("rotates active workstream when mode is rotate", () => {
    const registry = new ImplementerWorkstreamRegistry();
    const first = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    const second = registry.acquire({
      taskKey: "task-2",
      cwd: "/repo",
      mode: "rotate",
      rotationReason: "scope drift",
    });

    expect(second.workstreamId).not.toBe(first.workstreamId);
    expect(registry.get(first.workstreamId)?.status).toBe("rotated");
    expect(registry.get(first.workstreamId)?.rotationReason).toBe("scope drift");
  });

  test("completes workstream and prevents future reuse", () => {
    const registry = new ImplementerWorkstreamRegistry();
    const first = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    registry.complete(first.workstreamId);

    const second = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    expect(second.workstreamId).not.toBe(first.workstreamId);
  });

  test("closes previous task workstream when a different task starts", () => {
    const registry = new ImplementerWorkstreamRegistry();
    const first = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    const second = registry.acquire({ taskKey: "task-3", cwd: "/repo", mode: "auto" });

    expect(second.taskKey).toBe("task-3");
    expect(registry.get(first.workstreamId)?.status).toBe("completed");
  });
});
```

```ts
// tests/extension/subagent/persistence.test.ts
import { describe, expect, test } from "vitest";
import { WORKSTREAM_ENTRY_TYPE, restoreWorkstreamsFromBranch } from "../../../extensions/subagent/persistence";

describe("workstream persistence", () => {
  test("restores latest persisted active workstreams from branch entries", () => {
    const restored = restoreWorkstreamsFromBranch([
      { type: "custom", customType: WORKSTREAM_ENTRY_TYPE, data: { activeWorkstreams: [{ workstreamId: "w1", taskKey: "task-2", status: "active", cwd: "/repo", sessionId: "s1", createdAt: "2026-04-04T00:00:00.000Z", lastUsedAt: "2026-04-04T00:00:00.000Z", turnCount: 1 }] } },
    ] as any);

    expect(restored.listActive().map((item) => item.workstreamId)).toEqual(["w1"]);
  });
});
```

- [ ] **Step 2: Run the registry tests and confirm failure**

Run: `npx vitest run tests/extension/subagent/workstreams.test.ts tests/extension/subagent/persistence.test.ts`

Expected: FAIL with missing modules and missing registry/persistence exports.

- [ ] **Step 3: Implement the registry with explicit task-key policy**

```ts
// extensions/subagent/workstreams.ts
export type WorkstreamMode = "auto" | "fresh" | "rotate";

export interface ImplementerWorkstreamRecord {
  workstreamId: string;
  taskKey: string;
  status: "active" | "completed" | "rotated" | "failed";
  cwd: string;
  sessionId: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
  rotationReason?: string;
}

export class ImplementerWorkstreamRegistry {
  private records = new Map<string, ImplementerWorkstreamRecord>();

  acquire(input: { taskKey: string; cwd: string; mode: WorkstreamMode; rotationReason?: string }) {
    const existing = this.listActive().find((item) => item.taskKey === input.taskKey && item.cwd === input.cwd);
    if (input.mode === "auto" && existing) return this.touch(existing.workstreamId);
    for (const active of this.listActive()) {
      if (active.workstreamId === existing?.workstreamId && input.mode === "rotate") continue;
      if (active.taskKey !== input.taskKey) this.complete(active.workstreamId);
    }
    if (input.mode === "rotate" && existing) this.rotate(existing.workstreamId, input.rotationReason ?? "rotate requested");
    return this.create(input.taskKey, input.cwd);
  }

  create(taskKey: string, cwd: string) {
    const now = new Date().toISOString();
    const record: ImplementerWorkstreamRecord = {
      workstreamId: `ws-${Math.random().toString(36).slice(2, 10)}`,
      taskKey,
      status: "active",
      cwd,
      sessionId: `implementer-${taskKey}-${Date.now()}`,
      createdAt: now,
      lastUsedAt: now,
      turnCount: 0,
    };
    this.records.set(record.workstreamId, record);
    return record;
  }

  touch(workstreamId: string) {
    const record = this.records.get(workstreamId);
    if (!record) throw new Error(`Unknown workstream: ${workstreamId}`);
    const updated = { ...record, lastUsedAt: new Date().toISOString(), turnCount: record.turnCount + 1 };
    this.records.set(workstreamId, updated);
    return updated;
  }

  rotate(workstreamId: string, rotationReason: string) {
    const record = this.records.get(workstreamId);
    if (!record) return;
    this.records.set(workstreamId, { ...record, status: "rotated", rotationReason });
  }

  complete(workstreamId: string) {
    const record = this.records.get(workstreamId);
    if (!record) return;
    this.records.set(workstreamId, { ...record, status: "completed" });
  }

  get(workstreamId: string) {
    return this.records.get(workstreamId);
  }

  listActive() {
    return Array.from(this.records.values()).filter((item) => item.status === "active");
  }

  replaceAll(records: ImplementerWorkstreamRecord[]) {
    this.records = new Map(records.map((record) => [record.workstreamId, record]));
  }
}
```

- [ ] **Step 4: Implement persistence helpers with a dedicated custom entry type**

```ts
// extensions/subagent/persistence.ts
import { ImplementerWorkstreamRegistry, type ImplementerWorkstreamRecord } from "./workstreams.js";

export const WORKSTREAM_ENTRY_TYPE = "subagent_workstreams";

export function snapshotWorkstreams(registry: ImplementerWorkstreamRegistry) {
  return {
    activeWorkstreams: registry.listActive(),
  };
}

export function persistWorkstreams(
  appendEntry: (customType: string, data: unknown) => void,
  registry: ImplementerWorkstreamRegistry,
) {
  appendEntry(WORKSTREAM_ENTRY_TYPE, snapshotWorkstreams(registry));
}

export function restoreWorkstreamsFromBranch(entries: Array<{ type?: string; customType?: string; data?: unknown }>) {
  const registry = new ImplementerWorkstreamRegistry();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== WORKSTREAM_ENTRY_TYPE) continue;
    const data = entry.data as { activeWorkstreams?: ImplementerWorkstreamRecord[] } | undefined;
    registry.replaceAll(data?.activeWorkstreams ?? []);
    break;
  }
  return registry;
}
```

- [ ] **Step 5: Re-run the registry/persistence tests**

Run: `npx vitest run tests/extension/subagent/workstreams.test.ts tests/extension/subagent/persistence.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add extensions/subagent/workstreams.ts extensions/subagent/persistence.ts tests/extension/subagent/workstreams.test.ts tests/extension/subagent/persistence.test.ts
git commit -m "feat(subagent): add persisted implementer workstream registry"
```

### Task 3: Build The In-Process Implementer Runtime

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Create: `extensions/subagent/implementer-runtime.ts`
- Create: `tests/extension/subagent/implementer-runtime.test.ts`

- [ ] **Step 1: Write failing tests for session creation, reuse, and result collection**

```ts
// tests/extension/subagent/implementer-runtime.test.ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ImplementerRuntime } from "../../../extensions/subagent/implementer-runtime";

const { createAgentSessionMock } = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSession: createAgentSessionMock,
  };
});

describe("ImplementerRuntime", () => {
  beforeEach(() => {
    createAgentSessionMock.mockReset();
  });

  test("reuses the same AgentSession for the same active workstream", async () => {
    const prompt = vi.fn(async () => {});
    createAgentSessionMock.mockResolvedValue({ session: { prompt, subscribe: vi.fn(), messages: [] } });

    const runtime = new ImplementerRuntime();
    const record = {
      workstreamId: "ws-1",
      taskKey: "task-2",
      status: "active",
      cwd: process.cwd(),
      sessionId: "session-1",
      createdAt: "2026-04-04T00:00:00.000Z",
      lastUsedAt: "2026-04-04T00:00:00.000Z",
      turnCount: 0,
    } as const;

    await runtime.run({ record, agent: { name: "implementer", systemPrompt: "You are implementer", source: "project", filePath: "/tmp/implementer.md" } as any, task: "Task: implement feature" });
    await runtime.run({ record, agent: { name: "implementer", systemPrompt: "You are implementer", source: "project", filePath: "/tmp/implementer.md" } as any, task: "Task: fix reviewer issue" });

    expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the runtime test file and confirm failure**

Run: `npx vitest run tests/extension/subagent/implementer-runtime.test.ts`

Expected: FAIL with missing module `extensions/subagent/implementer-runtime.ts`.

- [ ] **Step 3: Implement the runtime around Pi SDK sessions**

```ts
// extensions/subagent/implementer-runtime.ts
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "./agents.js";
import type { SingleResult } from "./runtime-types.js";
import type { ImplementerWorkstreamRecord } from "./workstreams.js";

export class ImplementerRuntime {
  private sessions = new Map<string, any>();

  private async getOrCreateSession(record: ImplementerWorkstreamRecord, agent: AgentConfig) {
    const existing = this.sessions.get(record.workstreamId);
    if (existing) return existing;

    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const resourceLoader = new DefaultResourceLoader({
      cwd: record.cwd,
      systemPromptOverride: (base) => `${base}\n\n${agent.systemPrompt}`,
    });
    await resourceLoader.reload();

    const sessionManager = SessionManager.inMemory(record.cwd);
    const settingsManager = SettingsManager.inMemory();

    const { session } = await createAgentSession({
      cwd: record.cwd,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager,
      settingsManager,
      initialActiveToolNames: agent.tools,
    });

    this.sessions.set(record.workstreamId, session);
    return session;
  }

  async run(input: { record: ImplementerWorkstreamRecord; agent: AgentConfig; task: string }): Promise<SingleResult> {
    const session = await this.getOrCreateSession(input.record, input.agent);
    await session.prompt(`Task: ${input.task}`);
    const messages = session.messages ?? [];

    return {
      agent: input.agent.name,
      agentSource: input.agent.source,
      task: input.task,
      exitCode: 0,
      messages,
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    } as SingleResult;
  }

  dispose(workstreamId: string) {
    this.sessions.delete(workstreamId);
  }

  disposeAll() {
    this.sessions.clear();
  }
}
```

- [ ] **Step 4: Tighten the runtime result shape so `index.ts` can reuse current structured-output code**

```ts
// extensions/subagent/runtime-types.ts
export interface StableSingleAgentDetails {
  status: "completed" | "failed";
  agent: string;
  task: string;
  result: string;
  filesChanged: string[];
  testsRan: boolean;
  implementerStatus?: ImplementerStatus;
  tddViolations: number;
}
```

```ts
// extensions/subagent/implementer-runtime.ts
const finalText = messages
  .filter((message: any) => message.role === "assistant")
  .flatMap((message: any) => message.content)
  .filter((part: any) => part.type === "text")
  .map((part: any) => part.text)
  .join("\n");
```

- [ ] **Step 5: Re-run the implementer runtime tests**

Run: `npx vitest run tests/extension/subagent/implementer-runtime.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add extensions/subagent/implementer-runtime.ts extensions/subagent/runtime-types.ts tests/extension/subagent/implementer-runtime.test.ts
git commit -m "feat(subagent): add in-process implementer runtime"
```

### Task 4: Route Implementer Calls Through Workstream Policy

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Modify: `extensions/subagent/index.ts`
- Create: `tests/extension/subagent/routing.test.ts`

- [ ] **Step 1: Write failing routing tests for `taskKey`, `workstreamMode`, and reviewer isolation**

```ts
// tests/extension/subagent/routing.test.ts
import { describe, expect, test, vi } from "vitest";

const { runSubprocessAgentMock, implementerRunMock } = vi.hoisted(() => ({
  runSubprocessAgentMock: vi.fn(),
  implementerRunMock: vi.fn(),
}));

vi.mock("../../../extensions/subagent/subprocess-runtime.js", () => ({
  runSubprocessAgent: runSubprocessAgentMock,
}));

vi.mock("../../../extensions/subagent/implementer-runtime.js", () => ({
  ImplementerRuntime: vi.fn().mockImplementation(() => ({
    run: implementerRunMock,
    dispose: vi.fn(),
    disposeAll: vi.fn(),
  })),
}));

import subagentExtension from "../../../extensions/subagent";

describe("subagent routing", () => {
  test("routes implementer with taskKey to persistent runtime", async () => {
    let tool: any;
    subagentExtension({
      registerTool: (value: unknown) => {
        tool = value;
      },
      on: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
    } as any);

    implementerRunMock.mockResolvedValue({
      agent: "implementer",
      agentSource: "project",
      task: "Implement feature",
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    });

    await tool.execute("id", { agent: "implementer", task: "Implement feature", taskKey: "task-2" }, undefined, undefined, {
      cwd: process.cwd(),
      hasUI: false,
    });

    expect(implementerRunMock).toHaveBeenCalledTimes(1);
    expect(runSubprocessAgentMock).not.toHaveBeenCalled();
  });

  test("keeps reviewers on fresh subprocess path", async () => {
    let tool: any;
    subagentExtension({
      registerTool: (value: unknown) => {
        tool = value;
      },
      on: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
    } as any);

    runSubprocessAgentMock.mockResolvedValue({
      agent: "critical-reviewer",
      agentSource: "project",
      task: "Review diff",
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    });

    await tool.execute("id", { agent: "critical-reviewer", task: "Review diff" }, undefined, undefined, {
      cwd: process.cwd(),
      hasUI: false,
    });

    expect(runSubprocessAgentMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the new routing test and confirm failure**

Run: `npx vitest run tests/extension/subagent/routing.test.ts`

Expected: FAIL because `SubagentParams` does not yet accept `taskKey` / `workstreamMode`, and `index.ts` always uses the subprocess path.

- [ ] **Step 3: Extend the tool schema with explicit implementer workstream controls**

```ts
// extensions/subagent/index.ts
const WorkstreamModeSchema = StringEnum(["auto", "fresh", "rotate"] as const, {
  description: "Implementer workstream behavior. auto = reuse active task workstream, fresh = force new, rotate = replace active workstream.",
  default: "auto",
});

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
  task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
  taskKey: Type.Optional(Type.String({ description: "Stable task identity for implementer workstream reuse" })),
  workstreamMode: Type.Optional(WorkstreamModeSchema),
  rotationReason: Type.Optional(Type.String({ description: "Reason for rotating the active implementer workstream" })),
  tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
  chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
});
```

- [ ] **Step 4: Route `implementer` single-mode calls through the registry and persistent runtime**

```ts
// extensions/subagent/index.ts
const workstreams = restoreWorkstreamsFromBranch([]);
const implementerRuntime = new ImplementerRuntime();

if (params.agent === "implementer" && params.task) {
  const taskKey = params.taskKey;
  if (!taskKey) {
    const fresh = workstreams.create(`adhoc-${Date.now()}`, ctx.cwd);
    const result = await implementerRuntime.run({ record: fresh, agent, task: params.task });
    workstreams.complete(fresh.workstreamId);
    const finalText = getFinalOutput(result.messages) || "(no output)";
    return {
      content: [{ type: "text", text: finalText }],
      details: {
        ...makeDetails("single")([result]),
        status: "completed" as const,
        agent: result.agent,
        task: result.task,
        result: finalText,
        filesChanged: [],
        testsRan: false,
        implementerStatus: undefined,
        tddViolations: result.tddViolations ?? 0,
      },
    };
  }

  const record = workstreams.acquire({
    taskKey,
    cwd: path.resolve(params.cwd ?? ctx.cwd),
    mode: params.workstreamMode ?? "auto",
    rotationReason: params.rotationReason,
  });

  persistWorkstreams(pi.appendEntry.bind(pi), workstreams);

  const result = await implementerRuntime.run({
    record,
    agent,
    task: params.task,
  });

  const finalText = getFinalOutput(result.messages) || "(no output)";
  const summary = collectSummary(result.messages);
  const stableDetails = {
    ...makeDetails("single")([result]),
    status: "completed" as const,
    agent: result.agent,
    task: result.task,
    result: finalText,
    filesChanged: summary.filesChanged,
    testsRan: summary.testsRan,
    implementerStatus: summary.implementerStatus,
    tddViolations: result.tddViolations ?? 0,
  };

  persistWorkstreams(pi.appendEntry.bind(pi), workstreams);
  return {
    content: [{ type: "text", text: finalText }],
    details: stableDetails,
  };
}
```

- [ ] **Step 5: Run routing and existing single-agent tests**

Run: `npx vitest run tests/extension/subagent/routing.test.ts tests/extension/subagent/subagent-smoke.test.ts tests/extension/subagent/structured-result.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add extensions/subagent/index.ts tests/extension/subagent/routing.test.ts tests/extension/subagent/subagent-smoke.test.ts tests/extension/subagent/structured-result.test.ts
git commit -m "feat(subagent): route implementers through persistent workstreams"
```

### Task 5: Rehydrate Workstreams On Session Start And Show Lightweight Status

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Modify: `extensions/subagent/index.ts`
- Create: `tests/extension/subagent/session-lifecycle.test.ts`

- [ ] **Step 1: Write failing session lifecycle tests**

```ts
// tests/extension/subagent/session-lifecycle.test.ts
import { describe, expect, test, vi } from "vitest";
import subagentExtension from "../../../extensions/subagent";

describe("subagent session lifecycle", () => {
  test("restores persisted workstreams on session_start", async () => {
    const handlers = new Map<string, Function>();
    const setStatus = vi.fn();

    subagentExtension({
      registerTool: vi.fn(),
      on: (event: string, handler: Function) => {
        handlers.set(event, handler);
      },
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
    } as any);

    await handlers.get("session_start")?.(
      { type: "session_start", reason: "resume" },
      {
        hasUI: true,
        ui: { setStatus },
        sessionManager: {
          getBranch: () => [
            {
              type: "custom",
              customType: "subagent_workstreams",
              data: {
                activeWorkstreams: [
                  {
                    workstreamId: "ws-1",
                    taskKey: "task-2",
                    status: "active",
                    cwd: "/repo",
                    sessionId: "session-1",
                    createdAt: "2026-04-04T00:00:00.000Z",
                    lastUsedAt: "2026-04-04T00:00:00.000Z",
                    turnCount: 1,
                  },
                ],
              },
            },
          ],
        },
      },
    );

    expect(setStatus).toHaveBeenCalledWith("subagent", "Implementer: task-2 active");
  });
});
```

- [ ] **Step 2: Run the lifecycle test and confirm failure**

Run: `npx vitest run tests/extension/subagent/session-lifecycle.test.ts`

Expected: FAIL because the subagent extension does not yet register `session_start` handlers or restore workstream state.

- [ ] **Step 3: Add `session_start` / `session_shutdown` hooks and status refresh**

```ts
// extensions/subagent/index.ts
function updateImplementerStatus(ctx: any, registry: ImplementerWorkstreamRegistry) {
  if (!ctx.hasUI) return;
  const active = registry.listActive()[0];
  if (!active) {
    ctx.ui.setStatus("subagent", undefined);
    return;
  }
  ctx.ui.setStatus("subagent", `Implementer: ${active.taskKey} active`);
}

pi.on("session_start", async (_event, ctx) => {
  const restored = restoreWorkstreamsFromBranch(ctx.sessionManager.getBranch() as any[]);
  workstreams.replaceAll(restored.listActive());
  updateImplementerStatus(ctx, workstreams);
});

pi.on("session_shutdown", async (_event, ctx) => {
  updateImplementerStatus(ctx, workstreams);
  implementerRuntime.disposeAll();
});
```

- [ ] **Step 4: Persist completion/rotation transitions and refresh status after each implementer run**

```ts
// extensions/subagent/index.ts
const beforeIds = new Set(workstreams.listActive().map((item) => item.workstreamId));
const record = workstreams.acquire({
  taskKey,
  cwd: path.resolve(params.cwd ?? ctx.cwd),
  mode: params.workstreamMode ?? "auto",
  rotationReason: params.rotationReason,
});

for (const workstreamId of beforeIds) {
  if (workstreamId !== record.workstreamId && workstreams.get(workstreamId)?.status !== "active") {
    implementerRuntime.dispose(workstreamId);
  }
}

persistWorkstreams(pi.appendEntry.bind(pi), workstreams);
updateImplementerStatus(ctx, workstreams);
```

- [ ] **Step 5: Run lifecycle + persistence tests**

Run: `npx vitest run tests/extension/subagent/session-lifecycle.test.ts tests/extension/subagent/persistence.test.ts tests/extension/subagent/workstreams.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add extensions/subagent/index.ts tests/extension/subagent/session-lifecycle.test.ts tests/extension/subagent/persistence.test.ts tests/extension/subagent/workstreams.test.ts
git commit -m "feat(subagent): restore implementer workstreams across sessions"
```

### Task 6: Update Skills, Docs, And Full Verification

**TDD scenario:** Trivial change — use judgment

**Files:**
- Modify: `skills/subagent-driven-development/SKILL.md`
- Modify: `skills/subagent-driven-development/implementer-prompt.md`
- Modify: `README.md`

- [ ] **Step 1: Update the skill guidance so implementer dispatch always carries a stable task key**

```text
Add this guidance near the implementer dispatch examples in skills/subagent-driven-development/SKILL.md:

For implementer dispatches, always pass a stable `taskKey` for the current plan task.
Use the same `taskKey` for fix rounds within that task.

Example call:
subagent({ agent: "implementer", taskKey: "task-2", workstreamMode: "auto", task: "... full implementer prompt text ..." })

If the active implementer has accumulated bad context for the same task:
subagent({ agent: "implementer", taskKey: "task-2", workstreamMode: "rotate", rotationReason: "scope drift after reviewer feedback", task: "... full implementer prompt text ..." })
```

- [ ] **Step 2: Update the implementer prompt template to explain workstream continuity**

```md
<!-- skills/subagent-driven-development/implementer-prompt.md -->
When dispatching the implementer, the orchestrator may reuse the same workstream for this task.
That means follow-up prompts can assume prior task-local context is available.
Do not assume context from other tasks.
```

- [ ] **Step 3: Update the README to document the new hybrid behavior**

```md
<!-- README.md -->
- **Persistent implementer workstreams** — implementers now retain task-local context across follow-up rounds inside a task when the orchestrator supplies a stable `taskKey`.
- **Fresh reviewer sessions** — reviewers remain isolated by design so code review stays independent and less biased by prior conversation history.
```

- [ ] **Step 4: Run the full subagent and package verification**

Run: `npx vitest run tests/extension/subagent/ && npm run check`

Expected: PASS with all subagent tests green, full `vitest` suite green, and `biome check` clean.

- [ ] **Step 5: Commit**

```bash
git add skills/subagent-driven-development/SKILL.md skills/subagent-driven-development/implementer-prompt.md README.md
git commit -m "docs(subagent): document persistent implementer workstreams"
```

## Spec Coverage Check

- **Persistent implementer sessions:** Covered by Tasks 2, 3, 4, and 5.
- **Reviewer isolation:** Preserved in Tasks 1 and 4.
- **Silent orchestrator-controlled reuse:** Covered by Task 4 schema and policy routing.
- **Task-scoped lifetime with rotation:** Covered by Task 2 registry rules and Task 4 routing.
- **Session transition reconstruction:** Covered by Task 5.
- **Lightweight UI/status visibility:** Covered by Task 5.
- **Docs and skill updates:** Covered by Task 6.

## Placeholder Scan

Checked for forbidden plan placeholders:

- no `TBD`
- no `TODO`
- no "implement later"
- no "add validation" without code
- no task references that rely on reading another task out of order

## Consistency Check

- `taskKey` is the stable implementer identity throughout the plan.
- `workstreamMode` is consistently `auto | fresh | rotate`.
- Reviewer routing always stays on `runSubprocessAgent`.
- Implementer reuse only happens when `agent === "implementer"` and a `taskKey` is present.
