import { describe, test, expect, vi, beforeEach } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";

type Handler = (event: any, ctx: any) => any;

vi.mock("node:child_process", () => ({ execSync: vi.fn() }));
import { execSync } from "node:child_process";
const execSyncMock = execSync as unknown as ReturnType<typeof vi.fn>;

function createFakePi() {
  const handlers = new Map<string, Handler[]>();

  return {
    handlers,
    api: {
      on(event: string, handler: Handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      registerTool() {},
      registerCommand() {},
      appendEntry() {},
    },
  };
}

function getSingleHandler(handlers: Map<string, Handler[]>, event: string): Handler {
  const list = handlers.get(event) ?? [];
  expect(list.length).toBeGreaterThan(0);
  return list[0]!;
}

beforeEach(() => {
  execSyncMock.mockReset();
});

describe("branch safety monitor", () => {
  test("prepends current branch notice on the first tool_result of a session", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith("git branch")) return Buffer.from("my-branch\n");
      throw new Error("unexpected command");
    });

    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    const onToolResult = getSingleHandler(fake.handlers, "tool_result");

    const ctx = {
      hasUI: false,
      sessionManager: { getBranch: () => [] },
      ui: { setWidget: () => {} },
    };

    const res = await onToolResult(
      {
        toolName: "bash",
        input: { command: "echo hi" },
        content: [{ type: "text", text: "hi" }],
        details: { exitCode: 0 },
      },
      ctx
    );

    expect(res?.content?.[0]?.type).toBe("text");
    const text = res.content[0].text as string;
    expect(text).toContain("📌 Current branch: `my-branch`");
    expect(text).toContain("hi");
  });

  test("injects a first-write gate warning on the first write tool_result", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith("git branch")) return Buffer.from("topic/branch\n");
      throw new Error("unexpected command");
    });

    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    const onToolCall = getSingleHandler(fake.handlers, "tool_call");
    const onToolResult = getSingleHandler(fake.handlers, "tool_result");

    const ctx = {
      hasUI: false,
      sessionManager: { getBranch: () => [] },
      ui: { setWidget: () => {} },
    };

    await onToolCall({ toolName: "write", input: { path: "README.md", content: "x" } }, ctx);

    const res = await onToolResult(
      {
        toolName: "write",
        input: { path: "README.md", content: "x" },
        content: [{ type: "text", text: "ok" }],
        details: {},
      },
      ctx
    );

    const text = res.content[0].text as string;
    expect(text).toContain("⚠️ First write of this session.");
    expect(text).toContain("topic/branch");
  });

  test("branch notice is shown again after session_switch resets state", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith("git branch")) return Buffer.from("branch-a\n");
      throw new Error("unexpected command");
    });

    const fake = createFakePi();
    workflowMonitorExtension(fake.api as any);

    const onToolResult = getSingleHandler(fake.handlers, "tool_result");
    const onSessionSwitch = getSingleHandler(fake.handlers, "session_switch");

    const ctx = {
      hasUI: false,
      sessionManager: { getBranch: () => [] },
      ui: { setWidget: () => {} },
    };

    const res1 = await onToolResult(
      {
        toolName: "bash",
        input: { command: "echo 1" },
        content: [{ type: "text", text: "one" }],
        details: { exitCode: 0 },
      },
      ctx
    );
    expect(res1.content[0].text as string).toContain("branch-a");

    await onSessionSwitch({}, ctx);

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith("git branch")) return Buffer.from("branch-b\n");
      throw new Error("unexpected command");
    });

    const res2 = await onToolResult(
      {
        toolName: "bash",
        input: { command: "echo 2" },
        content: [{ type: "text", text: "two" }],
        details: { exitCode: 0 },
      },
      ctx
    );

    expect(res2.content[0].text as string).toContain("branch-b");
  });
});
