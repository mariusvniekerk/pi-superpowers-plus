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
      }),
    ).toEqual<SessionTransition>({
      cause: "new",
      previousSessionFile: "/tmp/prev.jsonl",
      shouldReconstructState: true,
      shouldClearEphemeralState: true,
      shouldResetBranchSafety: true,
    });
  });

  test("treats reload as reconstruction that still resets one-shot branch notices", () => {
    expect(
      normalizeSessionTransition({
        type: "session_start",
        reason: "reload",
      }),
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
      }),
    ).toMatchObject({
      cause: "tree",
      shouldReconstructState: true,
      shouldClearEphemeralState: true,
      shouldResetBranchSafety: true,
    });
  });

  test("supports legacy compatibility events when present", () => {
    expect(normalizeSessionTransition({ type: "session_switch" })).toMatchObject({
      cause: "legacy-switch",
      shouldResetBranchSafety: true,
    });
    expect(normalizeSessionTransition({ type: "session_fork" })).toMatchObject({
      cause: "legacy-fork",
      shouldResetBranchSafety: true,
    });
  });

  test("returns null for unknown event types", () => {
    expect(normalizeSessionTransition({ type: "session_resume" })).toBeNull();
  });

  test("identifies transitions that should trigger reset behavior", () => {
    expect(isSessionResetTransition(normalizeSessionTransition({ type: "session_start", reason: "startup" })!)).toBe(
      true,
    );
    expect(isSessionResetTransition(normalizeSessionTransition({ type: "session_start", reason: "reload" })!)).toBe(
      true,
    );
    expect(isSessionResetTransition(normalizeSessionTransition({ type: "session_start", reason: "resume" })!)).toBe(
      true,
    );
  });
});
