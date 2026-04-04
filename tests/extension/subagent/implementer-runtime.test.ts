import { beforeEach, describe, expect, test, vi } from "vitest";

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

import { ImplementerRuntime } from "../../../extensions/subagent/implementer-runtime.js";

describe("ImplementerRuntime", () => {
  beforeEach(() => {
    createAgentSessionMock.mockReset();
  });

  test("reuses the same AgentSession for the same active workstream", async () => {
    const session = {
      prompt: vi.fn(async () => {}),
      messages: [],
      sessionFile: "/tmp/implementer-session.jsonl",
      setActiveToolsByName: vi.fn(),
    };
    createAgentSessionMock.mockResolvedValue({ session });

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
    const agent = {
      name: "implementer",
      systemPrompt: "You are implementer",
      source: "project",
      filePath: "/tmp/implementer.md",
      tools: ["read", "bash", "edit", "write"],
    } as any;

    await runtime.run({ record, agent, task: "implement feature" });
    await runtime.run({ record, agent, task: "fix reviewer issue" });

    expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(session.setActiveToolsByName).toHaveBeenCalledTimes(1);
  });

  test("returns only new non-user messages from the current prompt", async () => {
    const sessionMessages: any[] = [{ role: "assistant", content: [{ type: "text", text: "old output" }] }];
    const session = {
      prompt: vi.fn(async () => {
        sessionMessages.push({ role: "user", content: "Task: implement feature" });
        sessionMessages.push({
          role: "assistant",
          content: [{ type: "text", text: "new output" }],
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: { total: 0.12 }, totalTokens: 15 },
          model: "provider/model-a",
        });
      }),
      get messages() {
        return sessionMessages;
      },
      sessionFile: "/tmp/implementer-session.jsonl",
      setActiveToolsByName: vi.fn(),
    };
    createAgentSessionMock.mockResolvedValue({ session });

    const runtime = new ImplementerRuntime();
    const result = await runtime.run({
      record: {
        workstreamId: "ws-1",
        taskKey: "task-2",
        status: "active",
        cwd: process.cwd(),
        sessionId: "session-1",
        createdAt: "2026-04-04T00:00:00.000Z",
        lastUsedAt: "2026-04-04T00:00:00.000Z",
        turnCount: 0,
      },
      agent: {
        name: "implementer",
        systemPrompt: "You are implementer",
        source: "project",
        filePath: "/tmp/implementer.md",
      } as any,
      task: "implement feature",
    });

    expect(result.messages).toMatchObject([{ role: "assistant", content: [{ type: "text", text: "new output" }] }]);
    expect(result.sessionFile).toBe("/tmp/implementer-session.jsonl");
    expect(result.usage).toEqual({
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      cost: 0.12,
      contextTokens: 15,
      turns: 1,
    });
    expect(result.model).toBe("provider/model-a");
  });

  test("propagates assistant stopReason and errorMessage into the result", async () => {
    const sessionMessages: any[] = [];
    const session = {
      prompt: vi.fn(async () => {
        sessionMessages.push({ role: "user", content: "Task: implement feature" });
        sessionMessages.push({
          role: "assistant",
          content: [{ type: "text", text: "provider failed" }],
          usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 }, totalTokens: 1 },
          model: "provider/model-a",
          stopReason: "error",
          errorMessage: "provider failed",
        });
      }),
      get messages() {
        return sessionMessages;
      },
      sessionFile: "/tmp/implementer-session.jsonl",
      setActiveToolsByName: vi.fn(),
    };
    createAgentSessionMock.mockResolvedValue({ session });

    const runtime = new ImplementerRuntime();
    const result = await runtime.run({
      record: {
        workstreamId: "ws-1",
        taskKey: "task-2",
        status: "active",
        cwd: process.cwd(),
        sessionId: "session-1",
        createdAt: "2026-04-04T00:00:00.000Z",
        lastUsedAt: "2026-04-04T00:00:00.000Z",
        turnCount: 0,
      },
      agent: {
        name: "implementer",
        systemPrompt: "You are implementer",
        source: "project",
        filePath: "/tmp/implementer.md",
      } as any,
      task: "implement feature",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("provider failed");
  });

  test("aborts the in-flight session when the signal is canceled", async () => {
    const controller = new AbortController();
    let abortDuringPrompt: (() => void) | undefined;
    const session = {
      prompt: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            abortDuringPrompt = () => reject(new Error("aborted by test"));
          }),
      ),
      messages: [],
      sessionFile: "/tmp/implementer-session.jsonl",
      setActiveToolsByName: vi.fn(),
      abort: vi.fn(async () => {
        abortDuringPrompt?.();
      }),
    };
    createAgentSessionMock.mockResolvedValue({ session });

    const runtime = new ImplementerRuntime();
    const promise = runtime.run({
      record: {
        workstreamId: "ws-1",
        taskKey: "task-2",
        status: "active",
        cwd: process.cwd(),
        sessionId: "session-1",
        createdAt: "2026-04-04T00:00:00.000Z",
        lastUsedAt: "2026-04-04T00:00:00.000Z",
        turnCount: 0,
      },
      agent: {
        name: "implementer",
        systemPrompt: "You are implementer",
        source: "project",
        filePath: "/tmp/implementer.md",
      } as any,
      task: "implement feature",
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow("Implementer was aborted");
    expect(session.abort).toHaveBeenCalledTimes(1);
  });
});
