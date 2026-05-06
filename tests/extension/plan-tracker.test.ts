import { describe, expect, test } from "vitest";
import planTrackerExtension from "../../extensions/plan-tracker";

type ToolDefinition = {
  name: string;
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: any,
  ) => Promise<any>;
};

function kataIssue(number: number, title = `issue ${number}`, status = "open", labels: string[] = []) {
  return JSON.stringify({
    kata_api_version: 1,
    issue: { number, title, status },
    labels: labels.map((label) => ({ label })),
  });
}

function createFakePi(responses: Array<{ stdout?: string; stderr?: string; code?: number }> = []) {
  const tools: ToolDefinition[] = [];
  const execCalls: Array<{ command: string; args: string[]; options: any }> = [];
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();

  return {
    tools,
    execCalls,
    handlers,
    api: {
      on(event: string, handler: (event: any, ctx: any) => unknown) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      registerTool(tool: ToolDefinition) {
        tools.push(tool);
      },
      async exec(command: string, args: string[], options: any) {
        execCalls.push({ command, args, options });
        const next = responses.shift() ?? { stdout: "{}", code: 0 };
        return {
          stdout: next.stdout ?? "",
          stderr: next.stderr ?? "",
          code: next.code ?? 0,
          killed: false,
        };
      },
    },
  };
}

function getPlanTracker(fake: ReturnType<typeof createFakePi>) {
  const tool = fake.tools.find((t) => t.name === "plan_tracker");
  expect(tool).toBeDefined();
  return tool!;
}

function expectKataCall(call: { command: string; args: string[] }, expectedArgs: string[]) {
  expect(call.command).toBe("kata");
  expect(call.args.slice(0, expectedArgs.length)).toEqual(expectedArgs);
}

describe("kata-backed plan_tracker", () => {
  test("init creates a parent kata issue and one child issue per task in the current workspace", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(10, "Plan") },
      { stdout: kataIssue(11) },
      { stdout: kataIssue(12) },
    ]);
    planTrackerExtension(fake.api as any);

    const result = await getPlanTracker(fake).execute(
      "call-1",
      { action: "init", tasks: ["Task 1: Setup", "Task 2: Core"] },
      undefined,
      undefined,
      { cwd: "/repo", hasUI: false },
    );

    expectKataCall(fake.execCalls[0]!, [
      "--workspace",
      "/repo",
      "--json",
      "create",
      "Plan: Task 1: Setup (+1 more)",
      "--body",
      "Task plan managed by pi-superpowers-plus.",
      "--label",
      "pi-plan",
    ]);
    expect(fake.execCalls[0]!.args).toContain("--idempotency-key");

    expectKataCall(fake.execCalls[1]!, [
      "--workspace",
      "/repo",
      "--json",
      "create",
      "Task 1: Setup",
      "--body",
      "Tracked by pi-superpowers-plus plan #10.",
      "--label",
      "pi-task",
      "--parent",
      "10",
    ]);
    expect(fake.execCalls[1]!.args).toContain("--idempotency-key");

    expectKataCall(fake.execCalls[2]!, [
      "--workspace",
      "/repo",
      "--json",
      "create",
      "Task 2: Core",
      "--body",
      "Tracked by pi-superpowers-plus plan #10.",
      "--label",
      "pi-task",
      "--parent",
      "10",
    ]);
    expect(fake.execCalls[2]!.args).toContain("--idempotency-key");

    expect(result.details.kata.parentIssueNumber).toBe(10);
    expect(result.details.tasks.map((task: any) => task.issueNumber)).toEqual([11, 12]);
    expect(result.content[0].text).toContain("Plan initialized with 2 tasks in kata (#10)");
  });

  test("re-init after clear uses a fresh idempotency scope", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(10, "Plan") },
      { stdout: kataIssue(11) },
      { stdout: kataIssue(20, "Plan") },
      { stdout: kataIssue(21) },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    await tool.execute("call-2", { action: "clear" }, undefined, undefined, { cwd: "/repo", hasUI: false });
    await tool.execute("call-3", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });

    const keys = fake.execCalls
      .map((call) => {
        const index = call.args.indexOf("--idempotency-key");
        return index === -1 ? undefined : call.args[index + 1];
      })
      .filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("no-index update records the current workflow phase in kata", async () => {
    const fake = createFakePi([{ stdout: kataIssue(90, "Workflow phase: brainstorm") }, { stdout: kataIssue(90) }]);
    planTrackerExtension(fake.api as any);

    const result = await getPlanTracker(fake).execute(
      "phase-call-1",
      { action: "update", status: "complete" },
      undefined,
      undefined,
      {
        cwd: "/repo",
        hasUI: false,
        sessionManager: {
          getBranch: () => [
            {
              type: "custom",
              customType: "superpowers_state",
              data: { workflow: { currentPhase: "brainstorm" } },
            },
          ],
        },
      },
    );

    expectKataCall(fake.execCalls[0]!, [
      "--workspace",
      "/repo",
      "--json",
      "create",
      "Workflow phase: brainstorm",
      "--body",
      "Workflow phase status managed by pi-superpowers-plus.",
      "--label",
      "pi-phase",
    ]);
    expect(fake.execCalls[0]!.args).toContain("--idempotency-key");
    expect(fake.execCalls[1]).toMatchObject({
      command: "kata",
      args: ["--workspace", "/repo", "--json", "close", "90", "--reason", "done"],
    });
    expect(result.details.kata.phaseIssueNumbers.brainstorm).toBe(90);
    expect(result.content[0].text).toContain("Workflow phase brainstorm → complete in kata (#90)");
  });

  test("complete update closes the mapped kata task issue", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(20, "Plan") },
      { stdout: kataIssue(21) },
      { stdout: kataIssue(21, "Task 1: Setup", "closed") },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    const result = await tool.execute(
      "call-2",
      { action: "update", index: 0, status: "complete" },
      undefined,
      undefined,
      { cwd: "/repo", hasUI: false },
    );

    expect(
      fake.execCalls.some((call) => call.args.join(" ") === "--workspace /repo --json close 21 --reason done"),
    ).toBe(true);
    expect(result.details.tasks[0]).toMatchObject({ name: "Task 1: Setup", status: "complete", issueNumber: 21 });
  });

  test("status refreshes mapped tasks from kata", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(30, "Plan") },
      { stdout: kataIssue(31) },
      { stdout: kataIssue(31, "Task 1: Setup", "closed") },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    const result = await tool.execute("call-2", { action: "status" }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });

    expect(fake.execCalls.at(-1)).toMatchObject({
      command: "kata",
      args: ["--workspace", "/repo", "--json", "show", "31"],
    });
    expect(result.content[0].text).toContain("✓ [0] #31 Task 1: Setup");
  });

  test("update reports kata command failures without changing task status", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(40, "Plan") },
      { stdout: kataIssue(41) },
      {
        stdout:
          '{"error":{"code":"project_not_initialized","message":"no kata project is attached to this workspace"}}',
        code: 4,
      },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    const result = await tool.execute(
      "call-2",
      { action: "update", index: 0, status: "complete" },
      undefined,
      undefined,
      { cwd: "/repo", hasUI: false },
    );

    expect(result.details.error).toContain("kata project is not initialized");
    expect(result.details.tasks[0]).toMatchObject({ status: "pending", issueNumber: 41 });
  });

  test("in_progress update is refreshed from kata labels", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(50, "Plan") },
      { stdout: kataIssue(51) },
      { stdout: kataIssue(51) },
      { stdout: kataIssue(51) },
      { stdout: kataIssue(51, "Task 1: Setup", "open", ["pi:in-progress"]) },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    await tool.execute("call-2", { action: "update", index: 0, status: "in_progress" }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    const result = await tool.execute("call-3", { action: "status" }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });

    expect(result.details.tasks[0]).toMatchObject({ status: "in_progress", issueNumber: 51 });
    expect(result.content[0].text).toContain("→ [0] #51 Task 1: Setup");
  });

  test("status reports kata failures instead of returning stale state", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(60, "Plan") },
      { stdout: kataIssue(61) },
      {
        stdout:
          '{"error":{"code":"project_not_initialized","message":"no kata project is attached to this workspace"}}',
        code: 4,
      },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    const result = await tool.execute("call-2", { action: "status" }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });

    expect(result.details.error).toContain("kata project is not initialized");
    expect(result.content[0].text).toContain("Run `kata init` in /repo");
  });

  test("updates mapped tasks in the workspace captured at init", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(70, "Plan") },
      { stdout: kataIssue(71) },
      { stdout: kataIssue(71, "Task 1: Setup", "closed") },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo-a",
      hasUI: false,
    });
    await tool.execute("call-2", { action: "update", index: 0, status: "complete" }, undefined, undefined, {
      cwd: "/repo-b",
      hasUI: false,
    });

    expect(
      fake.execCalls.some((call) => call.args.join(" ") === "--workspace /repo-a --json close 71 --reason done"),
    ).toBe(true);
  });

  test("pending update refreshes durable kata state after label removal failures", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(80, "Plan") },
      { stdout: kataIssue(81) },
      { stdout: kataIssue(81) },
      { stdout: '{"error":{"message":"label removal failed"}}', code: 1 },
      { stdout: kataIssue(81, "Task 1: Setup", "open", ["pi:in-progress"]) },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    const result = await tool.execute(
      "call-2",
      { action: "update", index: 0, status: "pending" },
      undefined,
      undefined,
      {
        cwd: "/repo",
        hasUI: false,
      },
    );

    expect(result.details.error).toContain("label removal failed");
    expect(result.details.tasks[0]).toMatchObject({ status: "in_progress", issueNumber: 81 });
  });

  test("complete update refreshes durable kata state after label removal failures", async () => {
    const fake = createFakePi([
      { stdout: kataIssue(82, "Plan") },
      { stdout: kataIssue(83) },
      { stdout: kataIssue(83, "Task 1: Setup", "closed") },
      { stdout: '{"error":{"message":"label removal failed"}}', code: 1 },
      { stdout: kataIssue(83, "Task 1: Setup", "closed", ["pi:in-progress"]) },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    const result = await tool.execute(
      "call-2",
      { action: "update", index: 0, status: "complete" },
      undefined,
      undefined,
      { cwd: "/repo", hasUI: false },
    );

    expect(result.details.error).toContain("label removal failed");
    expect(result.details.tasks[0]).toMatchObject({ status: "complete", issueNumber: 83 });
  });

  test("status reports missing kata issue mappings", async () => {
    const fake = createFakePi();
    planTrackerExtension(fake.api as any);
    const onSessionStart = fake.handlers.get("session_start")![0]!;
    await onSessionStart(
      { type: "session_start", reason: "startup" },
      {
        hasUI: false,
        sessionManager: {
          getBranch: () => [
            {
              type: "message",
              message: {
                role: "toolResult",
                toolName: "plan_tracker",
                details: {
                  action: "init",
                  tasks: [{ name: "Legacy task", status: "pending" }],
                  kata: { workspace: "/repo" },
                },
              },
            },
          ],
        },
      },
    );

    const result = await getPlanTracker(fake).execute("call-2", { action: "status" }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });

    expect(result.details.error).toContain("missing kata issue mapping");
  });

  test("update reports missing kata issue mappings without mutating local status", async () => {
    const fake = createFakePi();
    planTrackerExtension(fake.api as any);
    const onSessionStart = fake.handlers.get("session_start")![0]!;
    await onSessionStart(
      { type: "session_start", reason: "startup" },
      {
        hasUI: false,
        sessionManager: {
          getBranch: () => [
            {
              type: "message",
              message: {
                role: "toolResult",
                toolName: "plan_tracker",
                details: {
                  action: "init",
                  tasks: [{ name: "Legacy task", status: "pending" }],
                  kata: { workspace: "/repo" },
                },
              },
            },
          ],
        },
      },
    );

    const result = await getPlanTracker(fake).execute(
      "call-2",
      { action: "update", index: 0, status: "complete" },
      undefined,
      undefined,
      { cwd: "/repo", hasUI: false },
    );

    expect(result.details.error).toContain("missing kata issue mapping");
    expect(result.details.tasks[0]).toMatchObject({ name: "Legacy task", status: "pending" });
  });

  test("reports kata initialization errors without mutating tracker state", async () => {
    const fake = createFakePi([
      {
        stdout:
          '{"error":{"kind":"not_found","code":"project_not_initialized","message":"no kata project is attached to this workspace"}}',
        code: 4,
      },
    ]);
    planTrackerExtension(fake.api as any);

    const result = await getPlanTracker(fake).execute(
      "call-1",
      { action: "init", tasks: ["Task 1: Setup"] },
      undefined,
      undefined,
      { cwd: "/unbound", hasUI: false },
    );

    expect(result.details.error).toContain("kata project is not initialized");
    expect(result.details.tasks).toEqual([]);
    expect(result.content[0].text).toContain("Run `kata init` in /unbound");
  });
});
