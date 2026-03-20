import { describe, expect, test } from "vitest";
import workflowMonitorExtension from "../../../extensions/workflow-monitor";
import { createFakePi, getSingleHandler } from "./test-helpers";

describe("Phase Tracking Integration Tests", () => {
  test("reading skill file does NOT advance workflow phase", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api as any);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    // Start in brainstorm phase
    await inputHandler(
      { text: "/skill:brainstorming" },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    // Simulate reading a different skill file (as Pi does when loading available skills)
    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "read",
        input: { path: "/path/to/skills/subagent-driven-development/SKILL.md" },
        content: [{ type: "text", text: "---\nname: subagent-driven-development\n..." }],
        details: {},
      },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    // Phase should still be brainstorm, NOT execute
    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const lastState = stateEntries[stateEntries.length - 1]?.data.workflow;
    expect(lastState?.currentPhase).toBe("brainstorm");
    expect(lastState?.phases.execute).toBe("pending");
  });

  test("tests passing during finish phase marks verify as complete", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api as any);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    // Advance to finish phase
    await inputHandler(
      { text: "/skill:finishing-a-development-branch" },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    // Simulate tests passing
    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "npm test" },
        content: [{ type: "text", text: "5 tests passed" }],
        details: { exitCode: 0 },
      },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    // Verify should now be complete
    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    expect(stateEntries.length).toBeGreaterThan(0);
    const lastState = stateEntries[stateEntries.length - 1].data.workflow;
    expect(lastState.phases.verify).toBe("complete");
    expect(lastState.currentPhase).toBe("finish");
  });

  test("tests passing during finish preserves earlier completed phases", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api as any);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    // Simulate completing brainstorm, plan, execute phases first
    await inputHandler(
      { text: "/skill:brainstorming" },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );
    await inputHandler(
      { text: "/skill:writing-plans" },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );
    await inputHandler(
      { text: "/skill:subagent-driven-development" },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    // Get state after execute phase
    const stateBeforeFinish = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const executeState = stateBeforeFinish[stateBeforeFinish.length - 1]?.data.workflow;
    expect(executeState?.phases.brainstorm).toBe("complete");
    expect(executeState?.phases.plan).toBe("complete");
    expect(executeState?.phases.execute).toBe("active");

    // Advance to finish phase
    await inputHandler(
      { text: "/skill:finishing-a-development-branch" },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    // Simulate tests passing
    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "npm test" },
        content: [{ type: "text", text: "5 tests passed" }],
        details: { exitCode: 0 },
      },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    // Verify should be complete AND earlier phases should be preserved
    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const lastState = stateEntries[stateEntries.length - 1].data.workflow;
    expect(lastState.phases.verify).toBe("complete");
    expect(lastState.currentPhase).toBe("finish");
    // Critical: earlier phases must NOT be reset
    expect(lastState.phases.brainstorm).toBe("complete");
    expect(lastState.phases.plan).toBe("complete");
    expect(lastState.phases.execute).toBe("complete");
  });

  test("git push during finish marks review as complete", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api as any);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    await inputHandler(
      { text: "/skill:finishing-a-development-branch" },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git push origin main" },
        content: [{ type: "text", text: "pushed" }],
        details: { exitCode: 0 },
      },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const lastState = stateEntries[stateEntries.length - 1].data.workflow;
    expect(lastState.phases.review).toBe("complete");
    expect(lastState.currentPhase).toBe("finish");
  });

  test("gh pr create during finish marks review as complete", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api as any);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    await inputHandler(
      { text: "/skill:finishing-a-development-branch" },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "gh pr create --title 'Feature'" },
        content: [{ type: "text", text: "created PR #123" }],
        details: { exitCode: 0 },
      },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const lastState = stateEntries[stateEntries.length - 1].data.workflow;
    expect(lastState.phases.review).toBe("complete");
  });

  test("git merge during finish marks review as skipped", async () => {
    const { api, handlers, appendedEntries } = createFakePi({ withAppendEntry: true });
    workflowMonitorExtension(api as any);

    const inputHandler = getSingleHandler(handlers, "input");
    const toolResultHandler = getSingleHandler(handlers, "tool_result");

    await inputHandler(
      { text: "/skill:finishing-a-development-branch" },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    await toolResultHandler(
      {
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "git merge feature-branch" },
        content: [{ type: "text", text: "merged" }],
        details: { exitCode: 0 },
      },
      {
        hasUI: false,
        sessionManager: { getBranch: () => [] },
        ui: { setWidget: () => {}, select: () => {}, setEditorText: () => {}, notify: () => {} },
      },
    );

    const stateEntries = appendedEntries.filter((e: any) => e.customType === "superpowers_state");
    const lastState = stateEntries[stateEntries.length - 1].data.workflow;
    expect(lastState.phases.review).toBe("skipped");
    expect(lastState.currentPhase).toBe("finish");
  });
});
