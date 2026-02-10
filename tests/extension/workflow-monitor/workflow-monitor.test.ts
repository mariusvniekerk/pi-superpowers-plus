import { describe, test, expect, beforeEach } from "vitest";
import {
  createWorkflowHandler,
  type WorkflowHandler,
} from "../../../extensions/workflow-monitor/workflow-handler";

describe("WorkflowHandler", () => {
  let handler: WorkflowHandler;

  beforeEach(() => {
    handler = createWorkflowHandler();
  });

  test("detects write to source file as TDD violation", () => {
    const result = handler.handleToolCall("write", { path: "src/utils.ts", content: "code" });
    expect(result.violation).not.toBeNull();
    expect(result.violation?.type).toBe("source-before-test");
  });

  test("detects edit to source file as TDD violation", () => {
    const result = handler.handleToolCall("edit", {
      path: "src/utils.ts",
      oldText: "old",
      newText: "new",
    });
    expect(result.violation).not.toBeNull();
  });

  test("no violation for test file write", () => {
    const result = handler.handleToolCall("write", {
      path: "src/utils.test.ts",
      content: "test",
    });
    expect(result.violation).toBeNull();
  });

  test("no violation for non-write tools", () => {
    const result = handler.handleToolCall("read", { path: "src/utils.ts" });
    expect(result.violation).toBeNull();
  });

  test("handles bash test command result", () => {
    handler.handleToolCall("write", { path: "src/utils.test.ts", content: "test" });
    expect(handler.getTddPhase()).toBe("red");

    handler.handleBashResult("npx vitest run", "Tests  1 passed", 0);
    expect(handler.getTddPhase()).toBe("green");
  });

  test("handles bash git commit", () => {
    handler.handleToolCall("write", { path: "src/utils.test.ts", content: "test" });
    handler.handleBashResult("git commit -m 'feat: add utils'", "", 0);
    expect(handler.getTddPhase()).toBe("idle");
  });

  test("getWidgetText returns phase when active", () => {
    handler.handleToolCall("write", { path: "src/utils.test.ts", content: "test" });
    expect(handler.getWidgetText()).toContain("RED");
  });

  test("getWidgetText returns empty when idle", () => {
    expect(handler.getWidgetText()).toBe("");
  });

  // --- Debug monitor integration ---

  test("activates debug mode on test failure", () => {
    handler.handleBashResult("npx vitest run", "1 failing", 1);
    expect(handler.isDebugActive()).toBe(true);
  });

  test("detects fix-without-investigation on source write after test failure", () => {
    handler.handleBashResult("npx vitest run", "1 failing", 1);
    const result = handler.handleToolCall("edit", { path: "src/foo.ts", oldText: "a", newText: "b" });
    expect(result.violation?.type).toBe("fix-without-investigation");
  });

  test("no debug violation when investigated first", () => {
    handler.handleBashResult("npx vitest run", "1 failing", 1);
    handler.handleReadOrInvestigation("read", "src/foo.ts");
    const result = handler.handleToolCall("edit", { path: "src/foo.ts", oldText: "a", newText: "b" });
    expect(result.violation).toBeNull();
  });

  test("no debug violation when investigation bash command used", () => {
    handler.handleBashResult("npx vitest run", "1 failing", 1);
    handler.handleBashInvestigation("grep -rn 'error' src/");
    const result = handler.handleToolCall("edit", { path: "src/foo.ts", oldText: "a", newText: "b" });
    expect(result.violation).toBeNull();
  });

  test("tracks fix attempts across cycles", () => {
    handler.handleBashResult("npx vitest run", "1 failing", 1); // initial fail
    handler.handleReadOrInvestigation("read", "src/foo.ts");
    handler.handleToolCall("edit", { path: "src/foo.ts", oldText: "a", newText: "b" });
    handler.handleBashResult("npx vitest run", "1 failing", 1); // attempt 1
    handler.handleReadOrInvestigation("read", "src/foo.ts");
    handler.handleToolCall("edit", { path: "src/foo.ts", oldText: "b", newText: "c" });
    handler.handleBashResult("npx vitest run", "1 failing", 1); // attempt 2
    handler.handleReadOrInvestigation("read", "src/foo.ts");
    handler.handleToolCall("edit", { path: "src/foo.ts", oldText: "c", newText: "d" });
    handler.handleBashResult("npx vitest run", "1 failing", 1); // attempt 3
    handler.handleReadOrInvestigation("read", "src/foo.ts");
    const result = handler.handleToolCall("edit", { path: "src/foo.ts", oldText: "d", newText: "e" });
    expect(result.violation?.type).toBe("excessive-fix-attempts");
  });

  test("debug resets on test pass", () => {
    handler.handleBashResult("npx vitest run", "1 failing", 1);
    handler.handleReadOrInvestigation("read", "src/foo.ts");
    handler.handleToolCall("edit", { path: "src/foo.ts", oldText: "a", newText: "b" });
    handler.handleBashResult("npx vitest run", "1 passing", 0); // pass
    expect(handler.isDebugActive()).toBe(false);
  });

  test("debug resets on commit", () => {
    handler.handleBashResult("npx vitest run", "1 failing", 1);
    handler.handleBashResult("git commit -m 'fix'", "", 0);
    expect(handler.isDebugActive()).toBe(false);
  });

  test("widget shows debug state when active", () => {
    handler.handleBashResult("npx vitest run", "1 failing", 1);
    expect(handler.getWidgetText()).toContain("Debug");
  });
});
