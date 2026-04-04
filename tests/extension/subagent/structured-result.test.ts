import { describe, expect, test } from "vitest";
import { __internal } from "../../../extensions/subagent/index";

describe("subagent structured summary", () => {
  test("collects filesChanged + testsRan from tool-call messages", () => {
    const summary = __internal.collectSummary([
      {
        role: "assistant",
        content: [
          { type: "toolCall", name: "write", arguments: { path: "src/a.ts", content: "x" } },
          { type: "toolCall", name: "bash", arguments: { command: "npx vitest run" } },
        ],
      },
    ] as any);

    expect(summary.filesChanged).toEqual(["src/a.ts"]);
    expect(summary.testsRan).toBe(true);
  });

  test("extracts implementer status from assistant text output", () => {
    const summary = __internal.collectSummary([
      {
        role: "assistant",
        content: [{ type: "text", text: "**Status:** DONE_WITH_CONCERNS\n- Implemented feature" }],
      },
    ] as any);

    expect(summary.implementerStatus).toBe("DONE_WITH_CONCERNS");
  });

  test("accepts file_path in write/edit tool calls", () => {
    const summary = __internal.collectSummary([
      {
        role: "assistant",
        content: [{ type: "toolCall", name: "write", arguments: { file_path: "src/file.ts", content: "x" } }],
      },
    ] as any);

    expect(summary.filesChanged).toEqual(["src/file.ts"]);
  });
});
