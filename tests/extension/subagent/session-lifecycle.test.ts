import { describe, expect, test, vi } from "vitest";
import subagentExtension from "../../../extensions/subagent";

describe("subagent session lifecycle", () => {
  test("restores persisted workstreams on session_start", async () => {
    type Handler = (...args: unknown[]) => unknown;
    const handlers = new Map<string, Handler>();
    const setStatus = vi.fn();

    subagentExtension({
      registerTool: vi.fn(),
      on: (event: string, handler: Handler) => {
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
                    sessionFile: "/tmp/ws-1.jsonl",
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

  test("prefers the active workstream that matches the current cwd", async () => {
    type Handler = (...args: unknown[]) => unknown;
    const handlers = new Map<string, Handler>();
    const setStatus = vi.fn();

    subagentExtension({
      registerTool: vi.fn(),
      on: (event: string, handler: Handler) => {
        handlers.set(event, handler);
      },
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
    } as any);

    await handlers.get("session_start")?.(
      { type: "session_start", reason: "resume" },
      {
        cwd: "/repo-b",
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
                    cwd: "/repo-a",
                    sessionId: "session-1",
                    createdAt: "2026-04-04T00:00:00.000Z",
                    lastUsedAt: "2026-04-04T00:00:00.000Z",
                    turnCount: 1,
                  },
                  {
                    workstreamId: "ws-2",
                    taskKey: "task-3",
                    status: "active",
                    cwd: "/repo-b",
                    sessionId: "session-2",
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

    expect(setStatus).toHaveBeenCalledWith("subagent", "Implementer: task-3 active");
  });
});
