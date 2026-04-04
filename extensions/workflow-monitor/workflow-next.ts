import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { getUnresolvedPhasesBefore } from "./skip-confirmation";
import { type Phase, WORKFLOW_PHASES, type WorkflowTrackerState } from "./workflow-tracker";

const USAGE =
  "Usage: /workflow-next <phase> [--done <phase> ...] [artifact-path]  (phase: brainstorm|plan|execute|verify|review|finish)";

export interface WorkflowNextParseResult {
  targetPhase: Phase;
  artifactPath?: string;
  donePhases: Phase[];
}

export interface WorkflowNextFallbackPrompt {
  title: string;
  options: Array<{ label: string; value: "continue" | "cancel" }>;
  phasesToDeclare: Phase[];
}

function isPhase(value: string): value is Phase {
  return WORKFLOW_PHASES.includes(value as Phase);
}

function dedupePhases(phases: Phase[]): Phase[] {
  return [...new Set(phases)];
}

export function getWorkflowNextUsage(): string {
  return USAGE;
}

export function parseWorkflowNextArgs(args: string): WorkflowNextParseResult | null {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let targetPhase: Phase | null = null;
  const donePhases: Phase[] = [];
  let artifactPath: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (artifactPath) {
      artifactPath = `${artifactPath} ${token}`;
      continue;
    }

    if (token === "--done") {
      const phase = tokens[index + 1];
      if (!phase || !isPhase(phase)) return null;
      donePhases.push(phase);
      index += 1;
      continue;
    }

    if (!targetPhase && isPhase(token)) {
      targetPhase = token;
      continue;
    }

    if (!targetPhase) {
      return null;
    }

    artifactPath = token;
  }

  if (!targetPhase) return null;

  return {
    targetPhase,
    artifactPath,
    donePhases: dedupePhases(donePhases),
  };
}

export function buildWorkflowNextPrefill(targetPhase: Phase, artifactPath?: string): string {
  const lines: string[] = [];
  if (artifactPath) {
    lines.push(`Continue from artifact: ${artifactPath}`);
  }

  if (targetPhase === "plan") {
    lines.push("Use /skill:writing-plans to create the implementation plan.");
  } else if (targetPhase === "execute") {
    lines.push("Use /skill:executing-plans (or /skill:subagent-driven-development) to execute the plan.");
  } else if (targetPhase === "verify") {
    lines.push("Use /skill:verification-before-completion to verify before finishing.");
  } else if (targetPhase === "review") {
    lines.push("Use /skill:requesting-code-review to get review.");
  } else if (targetPhase === "finish") {
    lines.push("Use /skill:finishing-a-development-branch to integrate/ship.");
  }

  return lines.join("\n");
}

export function getWorkflowNextFallbackPrompt(
  targetPhase: Phase,
  currentState: WorkflowTrackerState,
  explicitlyDonePhases: Phase[],
): WorkflowNextFallbackPrompt | null {
  const explicitDone = new Set(explicitlyDonePhases);
  const unresolved = getUnresolvedPhasesBefore(targetPhase, currentState).filter((phase) => !explicitDone.has(phase));

  if (unresolved.length === 0) {
    return null;
  }

  const phaseList = unresolved.join(", ");
  return {
    title: `The earlier workflow phases appear unresolved: ${phaseList}. Mark them complete and continue?`,
    options: [
      { label: "Yes, continue", value: "continue" },
      { label: "No, cancel", value: "cancel" },
    ],
    phasesToDeclare: unresolved,
  };
}

export function getWorkflowNextArgumentCompletions(argumentPrefix: string): AutocompleteItem[] {
  const prefix = argumentPrefix ?? "";

  const phaseItems = WORKFLOW_PHASES.map((phase) => ({
    value: phase,
    label: phase,
    description: `Target phase: ${phase}`,
  }));

  const doneFlag = {
    value: prefix.endsWith(" ") || prefix.length === 0 ? `${prefix}--done ` : "--done ",
    label: "--done",
    description: "Declare an earlier workflow phase complete",
  };

  const doneMatch = prefix.match(/^(.*--done\s+)(\S*)$/);
  if (doneMatch) {
    const [, base, partial] = doneMatch;
    return WORKFLOW_PHASES.filter((phase) => phase.startsWith(partial)).map((phase) => ({
      value: `${base}${phase}`,
      label: phase,
      description: `Declare ${phase} complete`,
    }));
  }

  const partial = prefix.trim();
  if (partial.length === 0) {
    return [...phaseItems, doneFlag];
  }

  if (!prefix.includes(" ")) {
    return [
      ...WORKFLOW_PHASES.filter((phase) => phase.startsWith(partial)).map((phase) => ({
        value: phase,
        label: phase,
        description: `Target phase: ${phase}`,
      })),
      doneFlag,
    ];
  }

  if (prefix.endsWith(" ")) {
    return [doneFlag];
  }

  return [];
}
