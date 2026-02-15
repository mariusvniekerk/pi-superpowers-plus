import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createMockLogger } from "../../helpers/mock-logger.js";
import * as logging from "../../../extensions/logging.js";

const { spawnMock, discoverAgentsMock, unlinkSyncMock, rmSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  discoverAgentsMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
  rmSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  unlinkSyncMock.mockImplementation(actual.unlinkSync);
  rmSyncMock.mockImplementation(actual.rmSync);
  return {
    ...actual,
    unlinkSync: unlinkSyncMock,
    rmSync: rmSyncMock,
  };
});

vi.mock("../../../extensions/subagent/agents.js", () => ({
  discoverAgents: discoverAgentsMock,
}));

vi.mock("../../../extensions/logging.js", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof logging;
  return { ...actual, log: createMockLogger() };
});

import subagentExtension from "../../../extensions/subagent/index";

type Handler = (event: any, ctx: any) => any;

function createFakeProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => {
    proc.killed = true;
    return true;
  });
  proc.killed = false;
  return proc;
}

function registerTool() {
  let tool: any;
  subagentExtension({
    registerTool: (t: unknown) => {
      tool = t;
    },
    on: vi.fn() as unknown as Handler,
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
  } as any);
  return tool;
}

describe("subagent/index error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discoverAgentsMock.mockReturnValue({
      agents: [
        {
          name: "test-agent",
          source: "user",
          filePath: "/tmp/test-agent.md",
          systemPrompt: "system prompt",
        },
      ],
      projectAgentsDir: null,
    });
  });

  test("logs debug when subagent stdout line is not JSON", async () => {
    spawnMock.mockImplementation(() => {
      const proc = createFakeProcess();
      queueMicrotask(() => {
        proc.stdout.emit("data", Buffer.from("not-json\n"));
        proc.emit("close", 0);
      });
      return proc;
    });

    const tool = registerTool();
    await tool.execute("id", { agent: "test-agent", task: "do work" }, undefined, undefined, {
      cwd: process.cwd(),
      hasUI: false,
    });

    expect(logging.log.debug).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring non-JSON line from subagent stdout"),
    );
  });

  test("logs debug when temp cleanup fails", async () => {
    spawnMock.mockImplementation(() => {
      const proc = createFakeProcess();
      queueMicrotask(() => {
        proc.emit("close", 0);
      });
      return proc;
    });

    unlinkSyncMock.mockImplementation(() => {
      throw new Error("unlink failed");
    });
    rmSyncMock.mockImplementation(() => {
      throw new Error("rm failed");
    });

    const tool = registerTool();
    await tool.execute("id", { agent: "test-agent", task: "do work" }, undefined, undefined, {
      cwd: process.cwd(),
      hasUI: false,
    });

    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(fs.rmSync).toHaveBeenCalled();
    expect(logging.log.debug).toHaveBeenCalledWith(expect.stringContaining("Failed to clean up temp prompt file"));
    expect(logging.log.debug).toHaveBeenCalledWith(expect.stringContaining("Failed to clean up temp directory"));
  });
});
