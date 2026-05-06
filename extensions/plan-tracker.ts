/**
 * Kata-backed Plan Tracker Extension
 *
 * A native pi tool for tracking plan progress through kata.
 * The session stores only the kata issue mapping for branching support.
 * Kata remains the durable task ledger for the current project workspace.
 */

import { createHash } from "node:crypto";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import { normalizeSessionTransition } from "./shared/session-transition";

type TaskStatus = "pending" | "in_progress" | "complete";

interface Task {
  name: string;
  status: TaskStatus;
  issueNumber?: number;
}

interface KataTrackerState {
  workspace?: string;
  parentIssueNumber?: number;
  phaseIssueNumbers?: Record<string, number>;
}

interface PlanTrackerDetails {
  action: "init" | "update" | "status" | "clear";
  tasks: Task[];
  kata?: KataTrackerState;
  error?: string;
}

interface KataIssuePayload {
  issue?: {
    number?: number;
    title?: string;
    status?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
  labels?: Array<{
    label?: string;
  }>;
}

const PlanTrackerParams = Type.Object({
  action: StringEnum(["init", "update", "status", "clear"] as const, {
    description: "Action to perform",
  }),
  tasks: Type.Optional(
    Type.Array(Type.String(), {
      description: "Task names (for init)",
    }),
  ),
  index: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Task index, 0-based (for update)",
    }),
  ),
  status: Type.Optional(
    StringEnum(["pending", "in_progress", "complete"] as const, {
      description: "New status (for update)",
    }),
  ),
});

export type PlanTrackerInput = Static<typeof PlanTrackerParams>;

function formatWidget(tasks: Task[], theme: Theme): string {
  if (tasks.length === 0) return "";

  const complete = tasks.filter((t) => t.status === "complete").length;
  const icons = tasks
    .map((t) => {
      switch (t.status) {
        case "complete":
          return theme.fg("success", "✓");
        case "in_progress":
          return theme.fg("warning", "→");
        default:
          return theme.fg("dim", "○");
      }
    })
    .join("");

  const current = tasks.find((t) => t.status === "in_progress") ?? tasks.find((t) => t.status === "pending");
  const currentName = current ? `  ${formatTaskLabel(current)}` : "";

  return `${theme.fg("muted", "Kata Tasks:")} ${icons} ${theme.fg("muted", `(${complete}/${tasks.length})`)}${currentName}`;
}

function formatTaskLabel(task: Task): string {
  return task.issueNumber ? `#${task.issueNumber} ${task.name}` : task.name;
}

function formatStatus(tasks: Task[]): string {
  if (tasks.length === 0) return "No kata-backed plan active.";

  const complete = tasks.filter((t) => t.status === "complete").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;

  const lines: string[] = [];
  lines.push(`Plan: ${complete}/${tasks.length} complete (${inProgress} in progress, ${pending} pending)`);
  lines.push("");
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const icon = t.status === "complete" ? "✓" : t.status === "in_progress" ? "→" : "○";
    lines.push(`  ${icon} [${i}] ${formatTaskLabel(t)}`);
  }
  return lines.join("\n");
}

function titleForPlan(taskNames: string[]): string {
  const first = taskNames[0] ?? "Tasks";
  const extra = taskNames.length > 1 ? ` (+${taskNames.length - 1} more)` : "";
  return `Plan: ${first}${extra}`;
}

function workspaceFrom(ctx: ExtensionContext): string {
  return ctx.cwd || process.cwd();
}

function parseKataJson(stdout: string, stderr: string): KataIssuePayload {
  const raw = stdout.trim() || stderr.trim() || "{}";
  try {
    return JSON.parse(raw) as KataIssuePayload;
  } catch {
    return { error: { message: raw || "kata returned invalid JSON" } };
  }
}

function kataErrorMessage(payload: KataIssuePayload, fallback: string, workspace: string): string {
  const message = payload.error?.message || fallback;
  if (payload.error?.code === "project_not_initialized" || message.includes("project is attached")) {
    return `kata project is not initialized for ${workspace}. Run \`kata init\` in ${workspace} and retry.`;
  }
  return message;
}

function statusFromKata(payload: KataIssuePayload): TaskStatus {
  if (payload.issue?.status === "closed") return "complete";
  const labels = new Set((payload.labels ?? []).map((label) => label.label));
  if (labels.has("pi:in-progress")) return "in_progress";
  return "pending";
}

function idempotencyKey(kind: string, parts: string[]): string {
  const hash = createHash("sha1").update(parts.join("\0")).digest("hex");
  return `pi-superpowers-plus:${kind}:${hash}`;
}

function currentWorkflowPhase(ctx: ExtensionContext): string | undefined {
  const branch = ctx.sessionManager?.getBranch?.() ?? [];
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i] as { type?: string; customType?: string; data?: { workflow?: { currentPhase?: unknown } } };
    if (entry.type !== "custom" || entry.customType !== "superpowers_state") continue;
    const phase = entry.data?.workflow?.currentPhase;
    if (typeof phase === "string" && phase.length > 0) return phase;
  }
  return undefined;
}

export default function (pi: ExtensionAPI) {
  let tasks: Task[] = [];
  let kata: KataTrackerState = {};

  const runKata = async (ctx: ExtensionContext, args: string[], signal?: AbortSignal, workspace = kata.workspace) => {
    const targetWorkspace = workspace || workspaceFrom(ctx);
    return pi.exec("kata", ["--workspace", targetWorkspace, "--json", ...args], {
      cwd: targetWorkspace,
      signal,
      timeout: 30_000,
    });
  };

  const ensureKataSuccess = async (ctx: ExtensionContext, args: string[], signal?: AbortSignal) => {
    const workspace = kata.workspace || workspaceFrom(ctx);
    const result = await runKata(ctx, args, signal, workspace);
    const payload = parseKataJson(result.stdout, result.stderr);
    if (result.code !== 0 || payload.error) {
      throw new Error(kataErrorMessage(payload, `kata exited with code ${result.code}`, workspace));
    }
    return payload;
  };

  const failDetails = (action: PlanTrackerDetails["action"], error: string): PlanTrackerDetails => ({
    action,
    tasks: [...tasks],
    kata: { ...kata },
    error,
  });

  const createIssue = async (ctx: ExtensionContext, args: string[], signal?: AbortSignal) => {
    const payload = await ensureKataSuccess(ctx, args, signal);
    const number = payload.issue?.number;
    if (typeof number !== "number") {
      throw new Error("kata response did not include issue.number");
    }
    return number;
  };

  const ensurePhaseIssue = async (ctx: ExtensionContext, phase: string, signal?: AbortSignal) => {
    kata.phaseIssueNumbers ??= {};
    const existing = kata.phaseIssueNumbers[phase];
    if (existing) return existing;

    const title = `Workflow phase: ${phase}`;
    const issueNumber = await createIssue(
      ctx,
      [
        "create",
        title,
        "--body",
        "Workflow phase status managed by pi-superpowers-plus.",
        "--label",
        "pi-phase",
        "--idempotency-key",
        idempotencyKey("phase", [phase, title]),
      ],
      signal,
    );
    kata.phaseIssueNumbers[phase] = issueNumber;
    return issueNumber;
  };

  const refreshTaskFromKata = async (ctx: ExtensionContext, task: Task, signal?: AbortSignal): Promise<Task> => {
    if (!task.issueNumber) {
      throw new Error(`missing kata issue mapping for task "${task.name}"; re-run plan_tracker init`);
    }
    const result = await runKata(ctx, ["show", String(task.issueNumber)], signal);
    const payload = parseKataJson(result.stdout, result.stderr);
    if (result.code !== 0 || payload.error) {
      throw new Error(
        kataErrorMessage(payload, `kata exited with code ${result.code}`, kata.workspace || workspaceFrom(ctx)),
      );
    }
    return {
      ...task,
      name: payload.issue?.title ?? task.name,
      status: statusFromKata(payload),
    };
  };

  const refreshTaskStatuses = async (ctx: ExtensionContext, signal?: AbortSignal) => {
    const refreshed: Task[] = [];
    for (const task of tasks) {
      refreshed.push(await refreshTaskFromKata(ctx, task, signal));
    }
    tasks = refreshed;
  };

  const reconstructState = (ctx: ExtensionContext) => {
    tasks = [];
    kata = {};
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "plan_tracker") continue;
      const details = msg.details as PlanTrackerDetails | undefined;
      if (details && !details.error) {
        tasks = details.tasks;
        kata = details.kata ?? {};
      }
    }
  };

  const updateWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    if (tasks.length === 0) {
      ctx.ui.setWidget("plan_tracker", undefined);
    } else {
      ctx.ui.setWidget("plan_tracker", (_tui, theme) => {
        return new Text(formatWidget(tasks, theme), 0, 0);
      });
    }
  };

  const handleSessionTransition = (
    event: { type: string; reason?: string; previousSessionFile?: string },
    ctx: ExtensionContext,
  ) => {
    const transition = normalizeSessionTransition(event);
    if (!transition) return;

    if (transition.shouldReconstructState) {
      reconstructState(ctx);
    }

    updateWidget(ctx);
  };

  for (const event of ["session_start", "session_switch", "session_fork", "session_tree"] as const) {
    (pi as { on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>): void }).on(
      event,
      async (sessionEvent, ctx) => {
        handleSessionTransition(sessionEvent as { type: string; reason?: string; previousSessionFile?: string }, ctx);
      },
    );
  }

  pi.registerTool({
    name: "plan_tracker",
    label: "Plan Tracker",
    description:
      "Track implementation plan progress through kata. Actions: init (create kata plan/tasks), update (change task status), status (refresh current state), clear (remove widget/session mapping only).",
    promptGuidelines: [
      "Use plan_tracker for task tracking; it creates and updates kata issues in the current workspace.",
      "plan_tracker clear only clears the local widget/session mapping; it never deletes or purges kata issues.",
    ],
    parameters: PlanTrackerParams,

    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      switch (params.action) {
        case "init": {
          if (!params.tasks || params.tasks.length === 0) {
            return {
              content: [{ type: "text", text: "Error: tasks array required for init" }],
              details: failDetails("init", "tasks required"),
            };
          }

          const previousTasks = tasks;
          const previousKata = kata;
          tasks = [];
          kata = { workspace: workspaceFrom(ctx) };

          try {
            const planTitle = titleForPlan(params.tasks);
            const parentIssueNumber = await createIssue(
              ctx,
              [
                "create",
                planTitle,
                "--body",
                "Task plan managed by pi-superpowers-plus.",
                "--label",
                "pi-plan",
                "--idempotency-key",
                idempotencyKey("plan", [toolCallId, planTitle, ...params.tasks]),
              ],
              signal,
            );
            kata.parentIssueNumber = parentIssueNumber;

            const nextTasks: Task[] = [];
            for (let index = 0; index < params.tasks.length; index++) {
              const name = params.tasks[index];
              const issueNumber = await createIssue(
                ctx,
                [
                  "create",
                  name,
                  "--body",
                  `Tracked by pi-superpowers-plus plan #${parentIssueNumber}.`,
                  "--label",
                  "pi-task",
                  "--parent",
                  String(parentIssueNumber),
                  "--idempotency-key",
                  idempotencyKey("task", [toolCallId, String(parentIssueNumber), String(index), name]),
                ],
                signal,
              );
              nextTasks.push({ name, status: "pending", issueNumber });
            }
            tasks = nextTasks;
            updateWidget(ctx);
            return {
              content: [
                {
                  type: "text",
                  text: `Plan initialized with ${tasks.length} tasks in kata (#${parentIssueNumber}).\n${formatStatus(tasks)}`,
                },
              ],
              details: { action: "init", tasks: [...tasks], kata: { ...kata } } as PlanTrackerDetails,
            };
          } catch (error) {
            tasks = previousTasks;
            kata = previousKata;
            const message = error instanceof Error ? error.message : String(error);
            updateWidget(ctx);
            return {
              content: [{ type: "text", text: `Error: ${message}` }],
              details: failDetails("init", message),
            };
          }
        }

        case "update": {
          if (!params.status) {
            return {
              content: [{ type: "text", text: "Error: status required for update" }],
              details: failDetails("update", "status required"),
            };
          }

          if (params.index === undefined) {
            const phase = currentWorkflowPhase(ctx);
            if (!phase) {
              const message = "index required for kata task updates when no workflow phase is active";
              return {
                content: [{ type: "text", text: `Error: ${message}` }],
                details: failDetails("update", message),
              };
            }

            try {
              const issueNumber = await ensurePhaseIssue(ctx, phase, signal);
              if (params.status === "complete") {
                await ensureKataSuccess(ctx, ["close", String(issueNumber), "--reason", "done"], signal);
              } else {
                await ensureKataSuccess(ctx, ["reopen", String(issueNumber)], signal);
                if (params.status === "in_progress") {
                  await ensureKataSuccess(ctx, ["label", "add", String(issueNumber), "pi:in-progress"], signal);
                } else {
                  await ensureKataSuccess(ctx, ["label", "rm", String(issueNumber), "pi:in-progress"], signal);
                }
              }
              return {
                content: [
                  { type: "text", text: `Workflow phase ${phase} → ${params.status} in kata (#${issueNumber})` },
                ],
                details: { action: "update", tasks: [...tasks], kata: { ...kata } } as PlanTrackerDetails,
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return {
                content: [{ type: "text", text: `Error: ${message}` }],
                details: failDetails("update", message),
              };
            }
          }

          if (tasks.length === 0) {
            return {
              content: [{ type: "text", text: "Error: no kata-backed plan active. Use init first." }],
              details: failDetails("update", "no plan active"),
            };
          }
          if (params.index < 0 || params.index >= tasks.length) {
            const message = `index ${params.index} out of range`;
            return {
              content: [{ type: "text", text: `Error: index ${params.index} out of range (0-${tasks.length - 1})` }],
              details: failDetails("update", message),
            };
          }

          const task = tasks[params.index];
          if (!task.issueNumber) {
            const message = `missing kata issue mapping for task "${task.name}"; re-run plan_tracker init`;
            return {
              content: [{ type: "text", text: `Error: ${message}` }],
              details: failDetails("update", message),
            };
          }

          try {
            if (params.status === "complete") {
              await ensureKataSuccess(ctx, ["close", String(task.issueNumber), "--reason", "done"], signal);
              await ensureKataSuccess(ctx, ["label", "rm", String(task.issueNumber), "pi:in-progress"], signal);
            } else {
              await ensureKataSuccess(ctx, ["reopen", String(task.issueNumber)], signal);
              if (params.status === "in_progress") {
                await ensureKataSuccess(ctx, ["label", "add", String(task.issueNumber), "pi:in-progress"], signal);
              } else {
                await ensureKataSuccess(ctx, ["label", "rm", String(task.issueNumber), "pi:in-progress"], signal);
              }
            }
            tasks[params.index] = { ...task, status: params.status };
            updateWidget(ctx);
            return {
              content: [
                {
                  type: "text",
                  text: `Task ${params.index} "${formatTaskLabel(tasks[params.index])}" → ${params.status}\n${formatStatus(tasks)}`,
                },
              ],
              details: { action: "update", tasks: [...tasks], kata: { ...kata } } as PlanTrackerDetails,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try {
              tasks[params.index] = await refreshTaskFromKata(ctx, task, signal);
            } catch {}
            return {
              content: [{ type: "text", text: `Error: ${message}` }],
              details: failDetails("update", message),
            };
          }
        }

        case "status": {
          try {
            await refreshTaskStatuses(ctx, signal);
            updateWidget(ctx);
            return {
              content: [{ type: "text", text: formatStatus(tasks) }],
              details: { action: "status", tasks: [...tasks], kata: { ...kata } } as PlanTrackerDetails,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: `Error: ${message}` }],
              details: failDetails("status", message),
            };
          }
        }

        case "clear": {
          const count = tasks.length;
          tasks = [];
          kata = {};
          updateWidget(ctx);
          return {
            content: [
              {
                type: "text",
                text:
                  count > 0
                    ? `Plan widget cleared (${count} task mappings removed). Kata issues were left intact.`
                    : "No plan was active.",
              },
            ],
            details: { action: "clear", tasks: [], kata: {} } as PlanTrackerDetails,
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown action: ${params.action}` }],
            details: failDetails("status", "unknown action"),
          };
      }
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("plan_tracker "));
      text += theme.fg("muted", args.action);
      if (args.action === "update" && args.index !== undefined) {
        text += ` ${theme.fg("accent", `[${args.index}]`)}`;
        if (args.status) text += ` → ${theme.fg("dim", args.status)}`;
      }
      if (args.action === "init" && args.tasks) {
        text += ` ${theme.fg("dim", `(${args.tasks.length} kata tasks)`)}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as PlanTrackerDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (details.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      const taskList = details.tasks;
      switch (details.action) {
        case "init":
          return new Text(
            theme.fg("success", "✓ ") +
              theme.fg(
                "muted",
                `Kata plan #${details.kata?.parentIssueNumber ?? "?"} initialized with ${taskList.length} tasks`,
              ),
            0,
            0,
          );
        case "update": {
          const complete = taskList.filter((t) => t.status === "complete").length;
          return new Text(
            theme.fg("success", "✓ ") + theme.fg("muted", `Updated (${complete}/${taskList.length} complete)`),
            0,
            0,
          );
        }
        case "status": {
          if (taskList.length === 0) {
            return new Text(theme.fg("dim", "No kata-backed plan active"), 0, 0);
          }
          const complete = taskList.filter((t) => t.status === "complete").length;
          let text = theme.fg("muted", `${complete}/${taskList.length} complete`);
          for (const t of taskList) {
            const icon =
              t.status === "complete"
                ? theme.fg("success", "✓")
                : t.status === "in_progress"
                  ? theme.fg("warning", "→")
                  : theme.fg("dim", "○");
            text += `\n${icon} ${theme.fg("muted", formatTaskLabel(t))}`;
          }
          return new Text(text, 0, 0);
        }
        case "clear":
          return new Text(theme.fg("success", "✓ ") + theme.fg("muted", "Plan widget cleared; kata issues kept"), 0, 0);
        default:
          return new Text(theme.fg("dim", "Done"), 0, 0);
      }
    },
  });
}
