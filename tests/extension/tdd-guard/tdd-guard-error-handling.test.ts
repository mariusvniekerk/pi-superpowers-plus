import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMockLogger } from "../../helpers/mock-logger.js";
import * as logging from "../../../extensions/logging.js";

const { writeFileSyncMock } = vi.hoisted(() => ({
  writeFileSyncMock: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: writeFileSyncMock,
  };
});

vi.mock("../../../extensions/logging.js", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof logging;
  return { ...actual, log: createMockLogger() };
});

import tddGuardExtension from "../../../extensions/tdd-guard";

type Handler = (event: any, ctx: any) => any;

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

describe("tdd-guard.ts error handling", () => {
  const originalViolationsFile = process.env.PI_TDD_GUARD_VIOLATIONS_FILE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PI_TDD_GUARD_VIOLATIONS_FILE = "/tmp/tdd-guard-violations";
  });

  afterEach(() => {
    if (originalViolationsFile === undefined) {
      delete process.env.PI_TDD_GUARD_VIOLATIONS_FILE;
    } else {
      process.env.PI_TDD_GUARD_VIOLATIONS_FILE = originalViolationsFile;
    }
  });

  test("logs debug when persisting violations fails", async () => {
    writeFileSyncMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    const fake = createFakePi();
    tddGuardExtension(fake.api as any);

    const onToolCall = getSingleHandler(fake.handlers, "tool_call");
    await onToolCall(
      { toolCallId: "w1", toolName: "write", input: { path: "src/x.ts", content: "export const x = 1" } },
      { hasUI: false },
    );

    expect(logging.log.debug).toHaveBeenCalledWith(expect.stringContaining("Failed to persist TDD violations"));
  });
});
