export type SessionTransitionCause =
  | "startup"
  | "reload"
  | "new"
  | "resume"
  | "fork"
  | "tree"
  | "legacy-switch"
  | "legacy-fork";

export interface SessionTransition {
  cause: SessionTransitionCause;
  previousSessionFile?: string;
  shouldReconstructState: boolean;
  shouldClearEphemeralState: boolean;
  shouldResetBranchSafety: boolean;
}

type SessionEvent = {
  type: string;
  reason?: string;
  previousSessionFile?: string;
};

function buildTransition(cause: SessionTransitionCause, previousSessionFile?: string): SessionTransition {
  return {
    cause,
    previousSessionFile,
    shouldReconstructState: true,
    shouldClearEphemeralState: true,
    shouldResetBranchSafety: true,
  };
}

export function normalizeSessionTransition(event: SessionEvent): SessionTransition | null {
  if (event.type === "session_tree") {
    return buildTransition("tree");
  }

  if (event.type === "session_switch") {
    return buildTransition("legacy-switch", event.previousSessionFile);
  }

  if (event.type === "session_fork") {
    return buildTransition("legacy-fork", event.previousSessionFile);
  }

  if (event.type !== "session_start") {
    return null;
  }

  switch (event.reason) {
    case "startup":
      return buildTransition("startup");
    case "reload":
      return buildTransition("reload");
    case "new":
      return buildTransition("new", event.previousSessionFile);
    case "resume":
      return buildTransition("resume", event.previousSessionFile);
    case "fork":
      return buildTransition("fork", event.previousSessionFile);
    default:
      return buildTransition("startup");
  }
}

export function isSessionResetTransition(transition: SessionTransition): boolean {
  return transition.shouldResetBranchSafety;
}
