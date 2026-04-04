import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { log } from "../logging.js";
import type { AgentConfig } from "./agents.js";
import type { Semaphore } from "./concurrency.js";
import { buildSubagentEnv } from "./env.js";
import type { ProcessTracker } from "./lifecycle.js";
import type { SingleResult, UsageStats } from "./runtime-types.js";
import { getSubagentTimeoutMs } from "./timeout.js";

export const INACTIVITY_TIMEOUT_MS = 480_000;

export interface RunSubprocessAgentArgs {
  defaultCwd: string;
  agent: AgentConfig;
  task: string;
  cwd?: string;
  step?: number;
  signal?: AbortSignal;
  onUpdate?: (result: SingleResult) => void;
  processTracker: ProcessTracker;
  semaphore: Semaphore;
}

function writePromptToTempFile(tmpDir: string, agentName: string, prompt: string): { filePath: string } {
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { filePath };
}

function cloneUsage(usage: UsageStats): UsageStats {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cost: usage.cost,
    contextTokens: usage.contextTokens,
    turns: usage.turns,
  };
}

function cloneResult(result: SingleResult): SingleResult {
  return {
    ...result,
    messages: [...result.messages],
    usage: cloneUsage(result.usage),
  };
}

export async function runSubprocessAgent({
  defaultCwd,
  agent,
  task,
  cwd,
  step,
  signal,
  onUpdate,
  processTracker,
  semaphore,
}: RunSubprocessAgentArgs): Promise<SingleResult> {
  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);
  if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
  if (agent.extensions) {
    for (const ext of agent.extensions) {
      args.push("--extension", path.resolve(path.dirname(agent.filePath), ext));
    }
  }

  let tmpDir: string | null = null;
  let tmpPromptPath: string | null = null;
  let tddViolationsPath: string | null = null;
  let tddViolations = 0;

  const currentResult: SingleResult = {
    agent: agent.name,
    agentSource: agent.source,
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    model: agent.model,
    step,
  };

  if (semaphore.active >= semaphore.limit) {
    log.debug(`Subagent queued — ${semaphore.active}/${semaphore.limit} slots in use`);
  }

  const release = await semaphore.acquire();
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
    tddViolationsPath = path.join(tmpDir, "tdd-violations.txt");
    if (agent.systemPrompt.trim()) {
      const tmp = writePromptToTempFile(tmpDir, agent.name, agent.systemPrompt);
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPromptPath);
    }

    args.push(`Task: ${task}`);

    const resolvedCwd = cwd ? path.resolve(defaultCwd, cwd) : path.resolve(defaultCwd);
    let cwdError: string | undefined;
    try {
      const stat = fs.statSync(resolvedCwd);
      if (!stat.isDirectory()) cwdError = `Subagent cwd is not a directory: ${resolvedCwd}`;
    } catch {
      cwdError = `Subagent cwd does not exist: ${resolvedCwd}`;
    }
    if (cwdError) {
      return {
        agent: agent.name,
        agentSource: agent.source,
        task,
        exitCode: 1,
        messages: [],
        stderr: cwdError,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
        step,
        errorMessage: cwdError,
      };
    }

    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn("pi", args, {
        cwd: resolvedCwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: buildSubagentEnv(tddViolationsPath ? { PI_TDD_GUARD_VIOLATIONS_FILE: tddViolationsPath } : undefined),
      });
      processTracker.add(proc);
      let buffer = "";
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
      let absoluteTimer: ReturnType<typeof setTimeout> | null = null;
      let exitResolved = false;

      const resolveOnce = (code: number) => {
        if (exitResolved) return;
        exitResolved = true;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (absoluteTimer) clearTimeout(absoluteTimer);
        resolve(code);
      };

      let resetInactivityTimer = () => {};

      const emitUpdate = () => {
        onUpdate?.(cloneResult(currentResult));
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        // biome-ignore lint/suspicious/noExplicitAny: pi SDK JSON event type
        let event: any;
        try {
          event = JSON.parse(line);
        } catch (_err) {
          log.debug(`Ignoring non-JSON line from subagent stdout: ${line.slice(0, 120)}`);
          return;
        }

        if (event.type === "message_end" && event.message) {
          const msg = event.message as Message;
          currentResult.messages.push(msg);

          if (msg.role === "assistant") {
            currentResult.usage.turns++;
            const usage = msg.usage;
            if (usage) {
              currentResult.usage.input += usage.input || 0;
              currentResult.usage.output += usage.output || 0;
              currentResult.usage.cacheRead += usage.cacheRead || 0;
              currentResult.usage.cacheWrite += usage.cacheWrite || 0;
              currentResult.usage.cost += usage.cost?.total || 0;
              currentResult.usage.contextTokens = usage.totalTokens || 0;
            }
            if (!currentResult.model && msg.model) currentResult.model = msg.model;
            if (msg.stopReason) currentResult.stopReason = msg.stopReason;
            if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
          }
          emitUpdate();
          resetInactivityTimer();
        }

        if (event.type === "tool_result_end" && event.message) {
          currentResult.messages.push(event.message as Message);
          emitUpdate();
        }
      };

      resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          if (exitResolved) return;
          log.debug(`Subagent killed after ${INACTIVITY_TIMEOUT_MS}ms of inactivity`);
          currentResult.errorMessage = `Subagent killed after ${INACTIVITY_TIMEOUT_MS / 1000}s of inactivity`;
          if (buffer.trim()) processLine(buffer);
          proc.kill("SIGTERM");
          setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch {
              /* already exited */
            }
          }, 5000);
          resolveOnce(1);
        }, INACTIVITY_TIMEOUT_MS);
      };

      resetInactivityTimer();

      const absoluteTimeoutMs = getSubagentTimeoutMs(agent.timeout);
      absoluteTimer = setTimeout(() => {
        if (exitResolved) return;
        const seconds = Math.round(absoluteTimeoutMs / 1000);
        log.debug(`Subagent killed after ${seconds}s absolute timeout`);
        currentResult.errorMessage = `Subagent timed out after ${seconds}s`;
        if (buffer.trim()) processLine(buffer);
        proc.kill("SIGTERM");
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* already exited */
          }
        }, 5000);
        resolveOnce(1);
      }, absoluteTimeoutMs);

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        currentResult.stderr += data.toString();
      });

      proc.on("exit", (code) => {
        processTracker.remove(proc);
        if (exitResolved) return;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        setTimeout(() => {
          if (buffer.trim()) processLine(buffer);
          resolveOnce(code ?? 0);
        }, 2000);
      });

      proc.on("error", () => {
        processTracker.remove(proc);
        if (inactivityTimer) clearTimeout(inactivityTimer);
        resolveOnce(1);
      });

      if (signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch {
              /* already exited */
            }
          }, 5000);
        };
        if (signal.aborted) killProc();
        else signal.addEventListener("abort", killProc, { once: true });
      }
    });

    currentResult.exitCode = exitCode;
    if (tddViolationsPath && fs.existsSync(tddViolationsPath)) {
      const raw = fs.readFileSync(tddViolationsPath, "utf-8").trim();
      const parsed = Number.parseInt(raw || "0", 10);
      tddViolations = Number.isFinite(parsed) ? parsed : 0;
    }
    currentResult.tddViolations = tddViolations;
    if (wasAborted) throw new Error("Subagent was aborted");
    return currentResult;
  } finally {
    release();
    if (tmpPromptPath)
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch (err) {
        log.debug(
          `Failed to clean up temp prompt file: ${tmpPromptPath} — ${err instanceof Error ? err.message : err}`,
        );
      }
    if (tmpDir)
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        log.debug(`Failed to clean up temp directory: ${tmpDir} — ${err instanceof Error ? err.message : err}`);
      }
  }
}
