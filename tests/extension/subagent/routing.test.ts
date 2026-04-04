import { describe, expect, test, vi } from "vitest";

const { runSubprocessAgentMock, implementerRunMock } = vi.hoisted(() => ({
  runSubprocessAgentMock: vi.fn(),
  implementerRunMock: vi.fn(),
}));

vi.mock("../../../extensions/subagent/subprocess-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../extensions/subagent/subprocess-runtime.js")>();
  return {
    ...actual,
    runSubprocessAgent: runSubprocessAgentMock,
  };
});

vi.mock("../../../extensions/subagent/implementer-runtime.js", () => ({
  ImplementerRuntime: class {
    run = implementerRunMock;
    dispose = vi.fn();
    disposeAll = vi.fn();
  },
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
      sessionFile: "/tmp/implementer-session.jsonl",
    });

    await tool.execute(
      "id",
      { agent: "implementer", task: "Implement feature", taskKey: "task-2" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        hasUI: false,
      },
    );

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

  test("returns a structured error for ad-hoc implementer failures", async () => {
    let tool: any;
    subagentExtension({
      registerTool: (value: unknown) => {
        tool = value;
      },
      on: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
    } as any);

    implementerRunMock.mockRejectedValueOnce(new Error("SDK prompt failed"));

    const result = await tool.execute("id", { agent: "implementer", task: "Implement feature" }, undefined, undefined, {
      cwd: process.cwd(),
      hasUI: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Agent failed: SDK prompt failed" }]);
    expect(result.details.status).toBe("failed");
    expect(result.details.results[0].errorMessage).toBe("SDK prompt failed");
  });

  test("persists workstream transitions before and after implementer runtime failures", async () => {
    let tool: any;
    const appendEntry = vi.fn();
    subagentExtension({
      registerTool: (value: unknown) => {
        tool = value;
      },
      on: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry,
    } as any);

    implementerRunMock.mockRejectedValueOnce(new Error("SDK prompt failed"));

    const result = await tool.execute(
      "id",
      { agent: "implementer", task: "Implement feature", taskKey: "task-2" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        hasUI: false,
      },
    );

    expect(result.isError).toBe(true);
    expect(appendEntry).toHaveBeenCalledTimes(2);
    expect(appendEntry.mock.calls[0][1].activeWorkstreams).toHaveLength(1);
    expect(appendEntry.mock.calls[0][1].activeWorkstreams[0].taskKey).toBe("task-2");
    expect(appendEntry.mock.calls[1][1].activeWorkstreams).toHaveLength(1);
    expect(appendEntry.mock.calls[1][1].activeWorkstreams[0].taskKey).toBe("task-2");
  });
});
