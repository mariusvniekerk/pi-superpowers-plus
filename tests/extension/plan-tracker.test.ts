import { describe, expect, test, vi } from "vitest";
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

function kataIssue(ref: string, title = `issue ${ref}`, status = "open", labels: string[] = []) {
  return JSON.stringify({
    kata_api_version: 1,
    issue: { id: Number.parseInt(ref.replace(/\D/g, ""), 10) || 1, short_id: ref, title, status },
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
      { stdout: kataIssue("p10", "Plan") },
      { stdout: kataIssue("t11") },
      { stdout: kataIssue("t12") },
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
      "Tracked by pi-superpowers-plus plan kata#p10.",
      "--label",
      "pi-task",
      "--parent",
      "p10",
    ]);
    expect(fake.execCalls[1]!.args).toContain("--idempotency-key");

    expectKataCall(fake.execCalls[2]!, [
      "--workspace",
      "/repo",
      "--json",
      "create",
      "Task 2: Core",
      "--body",
      "Tracked by pi-superpowers-plus plan kata#p10.",
      "--label",
      "pi-task",
      "--parent",
      "p10",
    ]);
    expect(fake.execCalls[2]!.args).toContain("--idempotency-key");

    expect(result.details.kata.parentIssueRef).toBe("p10");
    expect(result.details.tasks.map((task: any) => task.issueRef)).toEqual(["t11", "t12"]);
    expect(result.content[0].text).toContain("Plan initialized with 2 tasks in kata (kata#p10)");
  });

  test("re-init after clear uses a fresh idempotency scope", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("p10", "Plan") },
      { stdout: kataIssue("t11") },
      { stdout: kataIssue("p20", "Plan") },
      { stdout: kataIssue("t21") },
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
    const fake = createFakePi([
      { stdout: kataIssue("ph90", "Workflow phase: brainstorm") },
      { stdout: kataIssue("ph90") },
      { stdout: kataIssue("ph90") },
    ]);
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
      args: [
        "--workspace",
        "/repo",
        "--json",
        "close",
        "ph90",
        "--reason",
        "done",
        "--message",
        expect.any(String),
        "--evidence",
        "test:plan-tracker-status-complete",
      ],
    });
    expect(fake.execCalls[2]).toMatchObject({
      command: "kata",
      args: ["--workspace", "/repo", "--json", "label", "rm", "ph90", "pi:in-progress"],
    });
    expect(result.details.kata.phaseIssueRefs.brainstorm).toBe("ph90");
    expect(result.content[0].text).toContain("Workflow phase brainstorm → complete in kata (kata#ph90)");
  });

  test("failed phase issue creation does not anchor future retries to the failed workspace", async () => {
    const fake = createFakePi([
      { stdout: '{"error":{"message":"create failed"}}', code: 1 },
      { stdout: kataIssue("i92", "Workflow phase: brainstorm") },
      { stdout: kataIssue("i92") },
      { stdout: kataIssue("i92") },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);
    const sessionManager = {
      getBranch: () => [
        {
          type: "custom",
          customType: "superpowers_state",
          data: { workflow: { currentPhase: "brainstorm" } },
        },
      ],
    };

    const failed = await tool.execute("phase-call-1", { action: "update", status: "complete" }, undefined, undefined, {
      cwd: "/bad-repo",
      hasUI: false,
      sessionManager,
    });
    await tool.execute("phase-call-2", { action: "update", status: "complete" }, undefined, undefined, {
      cwd: "/good-repo",
      hasUI: false,
      sessionManager,
    });

    expect(failed.details.kata.phaseIssueRefs).toBeUndefined();
    expectKataCall(fake.execCalls[1]!, ["--workspace", "/good-repo", "--json", "create", "Workflow phase: brainstorm"]);
  });

  test("init with shorter task list does not resume stale trailing task mappings", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i120", "Plan") },
      { stdout: kataIssue("i121", "Task 1: Setup") },
      { stdout: kataIssue("i122", "Task 2: Core") },
      { stdout: kataIssue("i130", "Plan") },
      { stdout: kataIssue("i131", "Task 1: Setup") },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup", "Task 2: Core"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    const result = await tool.execute("call-2", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });

    expect(result.details.kata.parentIssueRef).toBe("i130");
    expect(result.details.tasks.map((task: any) => task.issueRef)).toEqual(["i131"]);
  });

  test("init retry from a different workspace does not resume partial kata plan", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i150", "Plan") },
      { stdout: '{"error":{"message":"first child failed"}}', code: 1 },
      { stdout: kataIssue("i160", "Plan") },
      { stdout: kataIssue("i161", "Task 1: Setup") },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo-a",
      hasUI: false,
    });
    const retried = await tool.execute("call-2", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo-b",
      hasUI: false,
    });

    expectKataCall(fake.execCalls[2]!, ["--workspace", "/repo-b", "--json", "create", "Plan: Task 1: Setup"]);
    expect(retried.details.kata.parentIssueRef).toBe("i160");
    expect(retried.details.tasks.map((task: any) => task.issueRef)).toEqual(["i161"]);
  });

  test("init retry resumes parent-only partial kata plan", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i140", "Plan") },
      { stdout: '{"error":{"message":"first child failed"}}', code: 1 },
      { stdout: kataIssue("i141", "Task 1: Setup") },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    const failed = await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });
    const retried = await tool.execute("call-2", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, {
      cwd: "/repo",
      hasUI: false,
    });

    expect(failed.details.kata.parentIssueRef).toBe("i140");
    expectKataCall(fake.execCalls[2]!, [
      "--workspace",
      "/repo",
      "--json",
      "create",
      "Task 1: Setup",
      "--body",
      "Tracked by pi-superpowers-plus plan kata#i140.",
      "--label",
      "pi-task",
      "--parent",
      "i140",
    ]);
    expect(retried.details.kata.parentIssueRef).toBe("i140");
    expect(retried.details.tasks.map((task: any) => task.issueRef)).toEqual(["i141"]);
  });

  test("init retry resumes partial kata plan after child creation failure", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i110", "Plan") },
      { stdout: kataIssue("i111", "Task 1: Setup") },
      { stdout: '{"error":{"message":"child creation failed"}}', code: 1 },
      { stdout: kataIssue("i112", "Task 2: Core") },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);

    const failed = await tool.execute(
      "call-1",
      { action: "init", tasks: ["Task 1: Setup", "Task 2: Core"] },
      undefined,
      undefined,
      { cwd: "/repo", hasUI: false },
    );
    const retried = await tool.execute(
      "call-2",
      { action: "init", tasks: ["Task 1: Setup", "Task 2: Core"] },
      undefined,
      undefined,
      { cwd: "/repo", hasUI: false },
    );

    expect(failed.details.error).toContain("child creation failed");
    expect(failed.details.kata.parentIssueRef).toBe("i110");
    expect(failed.details.tasks.map((task: any) => task.issueRef)).toEqual(["i111"]);
    expectKataCall(fake.execCalls[3]!, [
      "--workspace",
      "/repo",
      "--json",
      "create",
      "Task 2: Core",
      "--body",
      "Tracked by pi-superpowers-plus plan kata#i110.",
      "--label",
      "pi-task",
      "--parent",
      "i110",
    ]);
    expect(retried.details.kata.parentIssueRef).toBe("i110");
    expect(retried.details.tasks.map((task: any) => task.issueRef)).toEqual(["i111", "i112"]);
  });

  test("phase issue updates keep using the workspace captured on first phase update", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i91", "Workflow phase: brainstorm") },
      { stdout: kataIssue("i91") },
      { stdout: kataIssue("i91") },
      { stdout: kataIssue("i91") },
      { stdout: kataIssue("i91") },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);
    const sessionManager = {
      getBranch: () => [
        {
          type: "custom",
          customType: "superpowers_state",
          data: { workflow: { currentPhase: "brainstorm" } },
        },
      ],
    };

    await tool.execute("phase-call-1", { action: "update", status: "in_progress" }, undefined, undefined, {
      cwd: "/repo-a",
      hasUI: false,
      sessionManager,
    });
    await tool.execute("phase-call-2", { action: "update", status: "complete" }, undefined, undefined, {
      cwd: "/repo-b",
      hasUI: false,
      sessionManager,
    });

    expect(
      fake.execCalls.some(
        (call) =>
          call.args.slice(0, 7).join(" ") === "--workspace /repo-a --json close i91 --reason done" &&
          call.args.includes("--message") &&
          call.args.includes("--evidence"),
      ),
    ).toBe(true);
  });

  test("complete update closes the mapped kata task issue", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i20", "Plan") },
      { stdout: kataIssue("i21") },
      { stdout: kataIssue("i21", "Task 1: Setup", "closed") },
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
      fake.execCalls.some(
        (call) =>
          call.args.slice(0, 7).join(" ") === "--workspace /repo --json close i21 --reason done" &&
          call.args.includes("--message") &&
          call.args.includes("--evidence"),
      ),
    ).toBe(true);
    expect(result.details.tasks[0]).toMatchObject({ name: "Task 1: Setup", status: "complete", issueRef: "i21" });
  });

  test("status refreshes mapped tasks from kata", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i30", "Plan") },
      { stdout: kataIssue("i31") },
      { stdout: kataIssue("i31", "Task 1: Setup", "closed") },
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
      args: ["--workspace", "/repo", "--json", "show", "i31"],
    });
    expect(result.content[0].text).toContain("✓ [0] kata#i31 Task 1: Setup");
  });

  test("update reports kata command failures without changing task status", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i40", "Plan") },
      { stdout: kataIssue("i41") },
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
    expect(result.details.tasks[0]).toMatchObject({ status: "pending", issueRef: "i41" });
  });

  test("in_progress update is refreshed from kata labels", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i50", "Plan") },
      { stdout: kataIssue("i51") },
      { stdout: kataIssue("i51") },
      { stdout: kataIssue("i51") },
      { stdout: kataIssue("i51", "Task 1: Setup", "open", ["pi:in-progress"]) },
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

    expect(result.details.tasks[0]).toMatchObject({ status: "in_progress", issueRef: "i51" });
    expect(result.content[0].text).toContain("→ [0] kata#i51 Task 1: Setup");
  });

  test("status reports kata failures instead of returning stale state", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i60", "Plan") },
      { stdout: kataIssue("i61") },
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
      { stdout: kataIssue("i70", "Plan") },
      { stdout: kataIssue("i71") },
      { stdout: kataIssue("i71", "Task 1: Setup", "closed") },
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
      fake.execCalls.some(
        (call) =>
          call.args.slice(0, 7).join(" ") === "--workspace /repo-a --json close i71 --reason done" &&
          call.args.includes("--message") &&
          call.args.includes("--evidence"),
      ),
    ).toBe(true);
  });

  test("pending update refreshes durable kata state after label removal failures", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i80", "Plan") },
      { stdout: kataIssue("i81") },
      { stdout: kataIssue("i81") },
      { stdout: '{"error":{"message":"label removal failed"}}', code: 1 },
      { stdout: kataIssue("i81", "Task 1: Setup", "open", ["pi:in-progress"]) },
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
    expect(result.details.tasks[0]).toMatchObject({ status: "in_progress", issueRef: "i81" });
  });

  test("partial update refreshes the widget after durable kata state changes", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i84", "Plan") },
      { stdout: kataIssue("i85") },
      { stdout: kataIssue("i85", "Task 1: Setup", "closed") },
      { stdout: '{"error":{"message":"label removal failed"}}', code: 1 },
      { stdout: kataIssue("i85", "Task 1: Setup", "closed", ["pi:in-progress"]) },
    ]);
    planTrackerExtension(fake.api as any);
    const tool = getPlanTracker(fake);
    const setWidget = vi.fn();
    const ctx = { cwd: "/repo", hasUI: true, ui: { setWidget } };

    await tool.execute("call-1", { action: "init", tasks: ["Task 1: Setup"] }, undefined, undefined, ctx);
    setWidget.mockClear();
    await tool.execute("call-2", { action: "update", index: 0, status: "complete" }, undefined, undefined, ctx);

    expect(setWidget).toHaveBeenCalledWith("plan_tracker", expect.any(Function));
  });

  test("complete update refreshes durable kata state after label removal failures", async () => {
    const fake = createFakePi([
      { stdout: kataIssue("i82", "Plan") },
      { stdout: kataIssue("i83") },
      { stdout: kataIssue("i83", "Task 1: Setup", "closed") },
      { stdout: '{"error":{"message":"label removal failed"}}', code: 1 },
      { stdout: kataIssue("i83", "Task 1: Setup", "closed", ["pi:in-progress"]) },
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
    expect(result.details.tasks[0]).toMatchObject({ status: "complete", issueRef: "i83" });
  });

  test("reconstructs refreshed task state from recoverable error results", async () => {
    const fake = createFakePi([{ stdout: kataIssue("i101", "Task 1: Setup", "closed") }]);
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
                  action: "update",
                  error: "label removal failed",
                  tasks: [{ name: "Task 1: Setup", status: "complete", issueRef: "i101" }],
                  kata: { workspace: "/repo" },
                },
              },
            },
          ],
        },
      },
    );

    const result = await getPlanTracker(fake).execute("call-2", { action: "status" }, undefined, undefined, {
      cwd: "/other",
      hasUI: false,
    });

    expect(fake.execCalls[0]).toMatchObject({
      command: "kata",
      args: ["--workspace", "/repo", "--json", "show", "i101"],
    });
    expect(result.details.tasks[0]).toMatchObject({ status: "complete", issueRef: "i101" });
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
                  tasks: [{ name: "Unmapped task", status: "pending" }],
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
                  tasks: [{ name: "Unmapped task", status: "pending" }],
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
    expect(result.details.tasks[0]).toMatchObject({ name: "Unmapped task", status: "pending" });
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
