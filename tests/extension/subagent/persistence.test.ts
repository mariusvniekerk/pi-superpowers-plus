import { describe, expect, test } from "vitest";
import {
  WORKSTREAM_ENTRY_TYPE,
  restoreWorkstreamsFromBranch,
  snapshotWorkstreams,
} from "../../../extensions/subagent/persistence.js";
import { ImplementerWorkstreamRegistry } from "../../../extensions/subagent/workstreams.js";

describe("workstream persistence", () => {
  test("creates a persistence snapshot from active workstreams", () => {
    const registry = new ImplementerWorkstreamRegistry();
    registry.acquire({ taskKey: "task-2", cwd: "/repo", mode: "auto" });

    expect(snapshotWorkstreams(registry).activeWorkstreams).toHaveLength(1);
  });

  test("restores latest persisted active workstreams from branch entries", () => {
    const restored = restoreWorkstreamsFromBranch([
      {
        type: "custom",
        customType: WORKSTREAM_ENTRY_TYPE,
        data: {
          activeWorkstreams: [
            {
              workstreamId: "w1",
              taskKey: "task-2",
              status: "active",
              cwd: "/repo",
              sessionId: "s1",
              createdAt: "2026-04-04T00:00:00.000Z",
              lastUsedAt: "2026-04-04T00:00:00.000Z",
              turnCount: 1,
            },
          ],
        },
      },
    ] as any);

    expect(restored.listActive().map((item) => item.workstreamId)).toEqual(["w1"]);
  });

  test("prefers the latest matching persistence entry in the branch", () => {
    const restored = restoreWorkstreamsFromBranch([
      {
        type: "custom",
        customType: WORKSTREAM_ENTRY_TYPE,
        data: {
          activeWorkstreams: [
            {
              workstreamId: "old",
              taskKey: "task-1",
              status: "active",
              cwd: "/repo",
              sessionId: "s-old",
              createdAt: "2026-04-04T00:00:00.000Z",
              lastUsedAt: "2026-04-04T00:00:00.000Z",
              turnCount: 0,
            },
          ],
        },
      },
      {
        type: "custom",
        customType: WORKSTREAM_ENTRY_TYPE,
        data: {
          activeWorkstreams: [
            {
              workstreamId: "new",
              taskKey: "task-2",
              status: "active",
              cwd: "/repo",
              sessionId: "s-new",
              createdAt: "2026-04-04T01:00:00.000Z",
              lastUsedAt: "2026-04-04T01:00:00.000Z",
              turnCount: 1,
            },
          ],
        },
      },
    ] as any);

    expect(restored.listActive().map((item) => item.workstreamId)).toEqual(["new"]);
  });
});
