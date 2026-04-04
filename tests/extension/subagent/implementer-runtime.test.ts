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
});
