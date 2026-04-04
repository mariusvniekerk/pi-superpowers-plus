import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { runSubprocessAgent } from "../../../extensions/subagent/subprocess-runtime";

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

describe("runSubprocessAgent", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  test("returns cwd error before spawning when directory does not exist", async () => {
    const result = await runSubprocessAgent({
      defaultCwd: process.cwd(),
      agent: {
        name: "critical-reviewer",
        source: "project",
        filePath: "/tmp/critical.md",
        systemPrompt: "",
      } as any,
      task: "review diff",
      cwd: "/definitely/missing",
      processTracker: { add() {}, remove() {} } as any,
      semaphore: { active: 0, limit: 1, acquire: async () => () => {} } as any,
    });

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("cwd does not exist");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test("emits updates as assistant messages arrive", async () => {
    const proc = createFakeProcess();
    spawnMock.mockReturnValue(proc);
    const onUpdate = vi.fn();

    const promise = runSubprocessAgent({
      defaultCwd: process.cwd(),
      agent: {
        name: "critical-reviewer",
        source: "project",
        filePath: "/tmp/critical.md",
        systemPrompt: "",
      } as any,
      task: "review diff",
      processTracker: { add() {}, remove() {} } as any,
      semaphore: { active: 0, limit: 1, acquire: async () => () => {} } as any,
      onUpdate,
    });

    queueMicrotask(() => {
      proc.stdout.emit(
        "data",
        Buffer.from(
          `${JSON.stringify({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Review started" }],
              usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 }, totalTokens: 3 },
            },
          })}\n`,
        ),
      );
      proc.emit("exit", 0);
    });

    const result = await promise;
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].messages).toHaveLength(1);
    expect(result.messages).toHaveLength(1);
  });

  test("resolves relative cwd against the provided default cwd", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "subprocess-runtime-test-"));
    const proc = createFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = runSubprocessAgent({
      defaultCwd: workspace,
      agent: {
        name: "critical-reviewer",
        source: "project",
        filePath: "/tmp/critical.md",
        systemPrompt: "",
      } as any,
      task: "review diff",
      cwd: ".",
      processTracker: { add() {}, remove() {} } as any,
      semaphore: { active: 0, limit: 1, acquire: async () => () => {} } as any,
    });

    queueMicrotask(() => {
      proc.emit("exit", 0);
    });

    await promise;

    expect(spawnMock.mock.calls[0][2].cwd).toBe(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  });
});
