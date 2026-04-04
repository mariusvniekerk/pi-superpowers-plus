import { describe, expect, test } from "vitest";
import { ImplementerWorkstreamRegistry } from "../../../extensions/subagent/workstreams.js";

describe("ImplementerWorkstreamRegistry", () => {
  test("reuses active workstream for same task key", () => {
    const registry = new ImplementerWorkstreamRegistry();
    const first = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    const second = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });

    expect(second.workstreamId).toBe(first.workstreamId);
    expect(second.turnCount).toBe(1);
    expect(registry.listActive()).toHaveLength(1);
  });

  test("rotates active workstream when mode is rotate", () => {
    const registry = new ImplementerWorkstreamRegistry();
    const first = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    const second = registry.acquire({
      taskKey: "task-2",
      cwd: "/repo",
      mode: "rotate",
      rotationReason: "scope drift",
    });

    expect(second.workstreamId).not.toBe(first.workstreamId);
    expect(registry.get(first.workstreamId)?.status).toBe("rotated");
    expect(registry.get(first.workstreamId)?.rotationReason).toBe("scope drift");
  });

  test("fresh mode replaces the active workstream for the same task", () => {
    const registry = new ImplementerWorkstreamRegistry();
    const first = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    const second = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "fresh" });
    const reused = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });

    expect(second.workstreamId).not.toBe(first.workstreamId);
    expect(registry.get(first.workstreamId)?.status).toBe("completed");
    expect(registry.listActive().map((item) => item.workstreamId)).toEqual([second.workstreamId]);
    expect(reused.workstreamId).toBe(second.workstreamId);
  });

  test("completes workstream and prevents future reuse", () => {
    const registry = new ImplementerWorkstreamRegistry();
    const first = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    registry.complete(first.workstreamId);

    const second = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    expect(second.workstreamId).not.toBe(first.workstreamId);
  });

  test("closes previous task workstream when a different task starts", () => {
    const registry = new ImplementerWorkstreamRegistry();
    const first = registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });
    const second = registry.acquire({ taskKey: "task-3", cwd: "/repo", mode: "auto" });

    expect(second.taskKey).toBe("task-3");
    expect(registry.get(first.workstreamId)?.status).toBe("completed");
    expect(registry.listActive().map((item) => item.taskKey)).toEqual(["task-3"]);
  });
});
