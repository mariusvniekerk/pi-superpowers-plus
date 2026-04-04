import { describe, expect, test } from "vitest";
import {
  type SessionTransition,
  isSessionResetTransition,
  normalizeSessionTransition,
} from "../../../extensions/shared/session-transition";

describe("session transition adapter", () => {
  test("maps session_start reasons from Pi 0.65+", () => {
    expect(
      normalizeSessionTransition({
        type: "session_start",
        reason: "new",
        previousSessionFile: "/tmp/prev.jsonl",
      } as any),
    ).toEqual<SessionTransition>({
      cause: "new",
      previousSessionFile: "/tmp/prev.jsonl",
      shouldReconstructState: true,
      shouldClearEphemeralState: true,
      shouldResetBranchSafety: true,
    });
  });

  test("treats reload as non-handoff reconstruction", () => {
    expect(
      normalizeSessionTransition({
        type: "session_start",
        reason: "reload",
      } as any),
    ).toMatchObject({
      cause: "reload",
      shouldReconstructState: true,
      shouldClearEphemeralState: true,
      shouldResetBranchSafety: true,
    });
  });

  test("keeps session_tree distinct from session_start", () => {
    expect(
      normalizeSessionTransition({
        type: "session_tree",
      } as any),
    ).toMatchObject({
      cause: "tree",
      shouldReconstructState: true,
      shouldClearEphemeralState: true,
      shouldResetBranchSafety: true,
    });
  });

  test("supports legacy compatibility events when present", () => {
    expect(normalizeSessionTransition({ type: "session_switch" } as any)?.cause).toBe("legacy-switch");
    expect(normalizeSessionTransition({ type: "session_fork" } as any)?.cause).toBe("legacy-fork");
  });

  test("identifies transitions that should trigger reset behavior", () => {
    expect(isSessionResetTransition({ cause: "startup" } as SessionTransition)).toBe(true);
    expect(isSessionResetTransition({ cause: "tree" } as SessionTransition)).toBe(true);
  });
});
