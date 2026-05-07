/**
 * Core execution logic for running subagents
 */

import { spawn } from "node:child_process";
import type { Message } from "@mariozechner/pi-ai";
import { buildSkillInjection, resolveSkills } from "pi-subagents/src/agents/skills.ts";
import { applyThinkingSuffix, buildPiArgs, cleanupTempDir } from "pi-subagents/src/runs/shared/pi-args.ts";
import { getPiSpawnCommand } from "pi-subagents/src/runs/shared/pi-spawn.ts";
import { captureSingleOutputSnapshot, resolveSingleOutput } from "pi-subagents/src/runs/shared/single-output.ts";
import {
  ensureArtifactsDir,
  getArtifactPaths,
  writeArtifact,
  writeMetadata,
} from "pi-subagents/src/shared/artifacts.ts";
import { createJsonlWriter } from "pi-subagents/src/shared/jsonl-writer.ts";
import {
  type AgentProgress,
  type ArtifactPaths,
  DEFAULT_MAX_OUTPUT,
  getSubagentDepthEnv,
  type RunSyncOptions,
  type SingleResult,
  truncateOutput,
} from "pi-subagents/src/shared/types.ts";
import {
  detectSubagentError,
  extractTextFromContent,
  extractToolArgsPreview,
  findLatestSessionFile,
  getFinalOutput,
} from "pi-subagents/src/shared/utils.ts";

const TURN_END_QUIESCENCE_MS = 700;

interface RuntimeAgentConfig {
  name: string;
  model?: string;
  thinking?: string;
  skills?: string[];
  systemPrompt?: string;
  tools?: string[];
  extensions?: string[];
  mcpDirectTools?: string[];
}

/**
 * Run a subagent synchronously (blocking until complete)
 */
export async function runSync(
  runtimeCwd: string,
  agents: RuntimeAgentConfig[],
  agentName: string,
  task: string,
  options: RunSyncOptions,
): Promise<SingleResult> {
  const { cwd, signal, onUpdate, maxOutput, artifactsDir, artifactConfig, runId, index, modelOverride } = options;
  const agent = agents.find((a) => a.name === agentName);
  if (!agent) {
    return {
      agent: agentName,
      task,
      exitCode: 1,
      messages: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
      error: `Unknown agent: ${agentName}`,
    };
  }

  const shareEnabled = options.share === true;
  const sessionEnabled = Boolean(options.sessionFile || options.sessionDir) || shareEnabled;
  const effectiveModel = modelOverride ?? agent.model;
  const modelArg = applyThinkingSuffix(effectiveModel, agent.thinking);
  const outputSnapshot = captureSingleOutputSnapshot(options.outputPath);

  const skillNames = options.skills ?? agent.skills ?? [];
  const { resolved: resolvedSkills, missing: missingSkills } = resolveSkills(skillNames, runtimeCwd);

  let systemPrompt = agent.systemPrompt?.trim() || "";
  if (resolvedSkills.length > 0) {
    const skillInjection = buildSkillInjection(resolvedSkills);
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${skillInjection}` : skillInjection;
  }

  const {
    args,
    env: sharedEnv,
    tempDir,
  } = buildPiArgs({
    baseArgs: ["--mode", "json", "-p"],
    task,
    sessionEnabled,
    sessionDir: options.sessionDir,
    sessionFile: options.sessionFile,
    model: effectiveModel,
    thinking: agent.thinking,
    systemPromptMode: "append",
    inheritProjectContext: true,
    inheritSkills: skillNames.length === 0,
    tools: agent.tools,
    extensions: agent.extensions,
    systemPrompt,
    mcpDirectTools: agent.mcpDirectTools,
    promptFileStem: agent.name,
  });

  const result: SingleResult = {
    agent: agentName,
    task,
    exitCode: 0,
    messages: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
    model: modelArg,
    skills: resolvedSkills.length > 0 ? resolvedSkills.map((s) => s.name) : undefined,
    skillsWarning: missingSkills.length > 0 ? `Skills not found: ${missingSkills.join(", ")}` : undefined,
  };

  const progress: AgentProgress = {
    index: index ?? 0,
    agent: agentName,
    status: "running",
    task,
    skills: resolvedSkills.length > 0 ? resolvedSkills.map((s) => s.name) : undefined,
    recentTools: [],
    recentOutput: [],
    toolCount: 0,
    tokens: 0,
    durationMs: 0,
  };
  result.progress = progress;

  const startTime = Date.now();

  let artifactPathsResult: ArtifactPaths | undefined;
  let jsonlPath: string | undefined;
  if (artifactsDir && artifactConfig?.enabled !== false) {
    artifactPathsResult = getArtifactPaths(artifactsDir, runId, agentName, index);
    ensureArtifactsDir(artifactsDir);
    if (artifactConfig?.includeInput !== false) {
      writeArtifact(artifactPathsResult.inputPath, `# Task for ${agentName}\n\n${task}`);
    }
    if (artifactConfig?.includeJsonl !== false) {
      jsonlPath = artifactPathsResult.jsonlPath;
    }
  }

  const spawnEnv = { ...process.env, ...sharedEnv, ...getSubagentDepthEnv(options.maxSubagentDepth) };

  let closeJsonlWriter: (() => Promise<void>) | undefined;
  const exitCode = await new Promise<number>((resolve) => {
    const spawnSpec = getPiSpawnCommand(args);
    const proc = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: cwd ?? runtimeCwd,
      env: spawnEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const jsonlWriter = createJsonlWriter(jsonlPath, proc.stdout);
    closeJsonlWriter = () => jsonlWriter.close();
    let buf = "";
    let stderrBuf = "";
    let processClosed = false;
    let settled = false;
    let sawAgentEnd = false;
    let turnEndTimer: ReturnType<typeof setTimeout> | undefined;
    let turnEndFallbackText: string | undefined;
    let terminationReason: "process_close" | "agent_end" | "turn_end_quiescence" = "process_close";

    const clearTurnEndTimer = () => {
      if (!turnEndTimer) return;
      clearTimeout(turnEndTimer);
      turnEndTimer = undefined;
    };

    const latestHarvestableText = () =>
      getFinalOutput(result.messages) ||
      turnEndFallbackText ||
      progress.recentOutput.filter((line) => line.trim()).slice(-1)[0];

    const settle = (code: number) => {
      clearTurnEndTimer();
      if (terminationReason === "turn_end_quiescence" && !result.error && !latestHarvestableText()) {
        terminationReason = "process_close";
      }
      if (settled) return;
      settled = true;
      processClosed = true;
      resolve(code);
    };

    const requestStop = () => {
      proc.kill("SIGTERM");
      setTimeout(() => !proc.killed && proc.kill("SIGKILL"), 3000);
    };

    const scheduleTurnEndFallback = () => {
      clearTurnEndTimer();
      if (!latestHarvestableText()) return;
      turnEndTimer = setTimeout(() => {
        terminationReason = "turn_end_quiescence";
        requestStop();
        settle(0);
      }, TURN_END_QUIESCENCE_MS);
    };

    const fireUpdate = () => {
      if (!onUpdate || processClosed) return;
      progress.durationMs = Date.now() - startTime;
      onUpdate({
        content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }],
        details: { mode: "single", results: [result], progress: [progress] },
      });
    };

    const processLine = (line: string) => {
      if (!line.trim()) return;
      jsonlWriter.writeLine(line);
      try {
        const evt = JSON.parse(line) as { type?: string; message?: Message; toolName?: string; args?: unknown };
        if (evt.type !== "turn_end") {
          clearTurnEndTimer();
        }
        const now = Date.now();
        progress.durationMs = now - startTime;

        if (evt.type === "tool_execution_start") {
          progress.toolCount++;
          progress.currentTool = evt.toolName;
          progress.currentToolArgs = extractToolArgsPreview((evt.args || {}) as Record<string, unknown>);
          fireUpdate();
        }

        if (evt.type === "tool_execution_end") {
          if (progress.currentTool) {
            progress.recentTools.push({
              tool: progress.currentTool,
              args: progress.currentToolArgs || "",
              endMs: now,
            });
          }
          progress.currentTool = undefined;
          progress.currentToolArgs = undefined;
          fireUpdate();
        }

        if (evt.type === "message_end" && evt.message) {
          result.messages.push(evt.message);
          if (evt.message.role === "assistant") {
            result.usage.turns++;
            const u = evt.message.usage;
            if (u) {
              result.usage.input += u.input || 0;
              result.usage.output += u.output || 0;
              result.usage.cacheRead += u.cacheRead || 0;
              result.usage.cacheWrite += u.cacheWrite || 0;
              result.usage.cost += u.cost?.total || 0;
              progress.tokens = result.usage.input + result.usage.output;
            }
            if (!result.model && evt.message.model) result.model = evt.message.model;
            if (evt.message.errorMessage) result.error = evt.message.errorMessage;

            const text = extractTextFromContent(evt.message.content);
            if (text) {
              const lines = text
                .split("\n")
                .filter((l) => l.trim())
                .slice(-10);
              progress.recentOutput.push(...lines);
              if (progress.recentOutput.length > 50) {
                progress.recentOutput.splice(0, progress.recentOutput.length - 50);
              }
            }
          }
          fireUpdate();
        }

        if (evt.type === "tool_result_end" && evt.message) {
          result.messages.push(evt.message);
          const toolText = extractTextFromContent(evt.message.content);
          if (toolText) {
            const toolLines = toolText
              .split("\n")
              .filter((l) => l.trim())
              .slice(-10);
            progress.recentOutput.push(...toolLines);
            if (progress.recentOutput.length > 50) {
              progress.recentOutput.splice(0, progress.recentOutput.length - 50);
            }
          }
          fireUpdate();
        }

        if (evt.type === "turn_end") {
          const turnEndText = evt.message ? extractTextFromContent(evt.message.content) : "";
          if (turnEndText) {
            turnEndFallbackText = turnEndText;
            if (progress.recentOutput.length === 0) {
              const lines = turnEndText
                .split("\n")
                .filter((l) => l.trim())
                .slice(-10);
              progress.recentOutput.push(...lines);
            }
          }
          fireUpdate();
          scheduleTurnEndFallback();
        }

        if (evt.type === "agent_end") {
          sawAgentEnd = true;
          terminationReason = "agent_end";
          requestStop();
          settle(0);
        }
      } catch {
        // Non-JSON stdout lines are expected; only structured events are parsed.
      }
    };

    proc.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      lines.forEach(processLine);
    });
    proc.stderr.on("data", (d) => {
      stderrBuf += d.toString();
    });
    proc.on("close", (code) => {
      if (buf.trim()) processLine(buf);
      if (sawAgentEnd || terminationReason === "turn_end_quiescence") {
        settle(0);
        return;
      }
      if (code !== 0 && stderrBuf.trim() && !result.error) {
        result.error = stderrBuf.trim();
      }
      settle(code ?? 0);
    });
    proc.on("error", () => settle(1));

    if (signal) {
      if (signal.aborted) requestStop();
      else signal.addEventListener("abort", requestStop, { once: true });
    }
  });

  if (closeJsonlWriter) {
    try {
      await closeJsonlWriter();
    } catch {
      // JSONL artifact flush is best effort.
    }
  }

  cleanupTempDir(tempDir);
  result.exitCode = exitCode;

  if (exitCode === 0 && !result.error) {
    const errInfo = detectSubagentError(result.messages);
    if (errInfo.hasError) {
      result.exitCode = errInfo.exitCode ?? 1;
      result.error = errInfo.details
        ? `${errInfo.errorType} failed (exit ${errInfo.exitCode}): ${errInfo.details}`
        : `${errInfo.errorType} failed with exit code ${errInfo.exitCode}`;
    }
  }

  progress.status = result.exitCode === 0 ? "completed" : "failed";
  progress.durationMs = Date.now() - startTime;
  if (result.error) {
    progress.error = result.error;
    if (progress.currentTool) {
      progress.failedTool = progress.currentTool;
    }
  }

  result.progress = progress;
  result.progressSummary = {
    toolCount: progress.toolCount,
    tokens: progress.tokens,
    durationMs: progress.durationMs,
  };

  let fullOutput =
    getFinalOutput(result.messages) || progress.recentOutput.filter((line) => line.trim()).slice(-1)[0] || "";
  if (options.outputPath && result.exitCode === 0) {
    const resolvedOutput = resolveSingleOutput(options.outputPath, fullOutput, outputSnapshot);
    fullOutput = resolvedOutput.fullOutput;
    result.savedOutputPath = resolvedOutput.savedPath;
    result.outputSaveError = resolvedOutput.saveError;
  }
  result.finalOutput = fullOutput;

  if (artifactPathsResult && artifactConfig?.enabled !== false) {
    result.artifactPaths = artifactPathsResult;

    if (artifactConfig?.includeOutput !== false) {
      writeArtifact(artifactPathsResult.outputPath, fullOutput);
    }
    if (artifactConfig?.includeMetadata !== false) {
      writeMetadata(artifactPathsResult.metadataPath, {
        runId,
        agent: agentName,
        task,
        exitCode: result.exitCode,
        usage: result.usage,
        model: result.model,
        durationMs: progress.durationMs,
        toolCount: progress.toolCount,
        error: result.error,
        skills: result.skills,
        skillsWarning: result.skillsWarning,
        timestamp: Date.now(),
      });
    }

    if (maxOutput) {
      const config = { ...DEFAULT_MAX_OUTPUT, ...maxOutput };
      const truncationResult = truncateOutput(fullOutput, config, artifactPathsResult.outputPath);
      if (truncationResult.truncated) {
        result.truncation = truncationResult;
      }
    }
  } else if (maxOutput) {
    const config = { ...DEFAULT_MAX_OUTPUT, ...maxOutput };
    const truncationResult = truncateOutput(fullOutput, config);
    if (truncationResult.truncated) {
      result.truncation = truncationResult;
    }
  }

  if (shareEnabled) {
    const sessionFile = options.sessionFile ?? (options.sessionDir ? findLatestSessionFile(options.sessionDir) : null);
    if (sessionFile) {
      result.sessionFile = sessionFile;
      // HTML export disabled - module resolution issues with global pi installation
      // Users can still access the session file directly
    }
  }

  return result;
}
