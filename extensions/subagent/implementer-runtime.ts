import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Api } from "@mariozechner/pi-ai";
import type { AgentSession, Model } from "@mariozechner/pi-coding-agent";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "./agents.js";
import type { SingleResult, UsageStats } from "./runtime-types.js";
import type { ImplementerWorkstreamRecord } from "./workstreams.js";

function getImplementerSessionDir(cwd: string): string {
  const cwdHash = createHash("sha1").update(cwd).digest("hex");
  return join(getAgentDir(), "sessions", "subagents", cwdHash);
}

function resolveModel(agent: AgentConfig, modelRegistry: ModelRegistry): Model<Api> | undefined {
  if (!agent.model) return undefined;
  return modelRegistry
    .getAll()
    .find((model) => model.id === agent.model || `${model.provider}/${model.id}` === agent.model);
}

function collectUsage(messages: SingleResult["messages"]): { usage: UsageStats; model?: string } {
  const usage: UsageStats = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  };
  let model: string | undefined;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    usage.turns++;
    if (message.usage) {
      usage.input += message.usage.input || 0;
      usage.output += message.usage.output || 0;
      usage.cacheRead += message.usage.cacheRead || 0;
      usage.cacheWrite += message.usage.cacheWrite || 0;
      usage.cost += message.usage.cost?.total || 0;
      usage.contextTokens = message.usage.totalTokens || usage.contextTokens;
    }
    if (!model && message.model) model = message.model;
  }

  return { usage, model };
}

function collectTerminalState(messages: SingleResult["messages"]): {
  stopReason?: SingleResult["stopReason"];
  errorMessage?: string;
  exitCode: number;
} {
  let stopReason: SingleResult["stopReason"];
  let errorMessage: string | undefined;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.stopReason) stopReason = message.stopReason;
    if (message.errorMessage) errorMessage = message.errorMessage;
  }

  return {
    stopReason,
    errorMessage,
    exitCode: stopReason === "error" || stopReason === "aborted" ? 1 : 0,
  };
}

export class ImplementerRuntime {
  private sessions = new Map<string, AgentSession>();

  private async getOrCreateSession(record: ImplementerWorkstreamRecord, agent: AgentConfig): Promise<AgentSession> {
    const existing = this.sessions.get(record.workstreamId);
    if (existing) return existing;

    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd: record.cwd,
      settingsManager,
      systemPromptOverride: (base) => [base, agent.systemPrompt].filter(Boolean).join("\n\n"),
    });
    await resourceLoader.reload();

    const sessionDir = getImplementerSessionDir(record.cwd);
    const sessionManager =
      record.sessionFile && existsSync(record.sessionFile)
        ? SessionManager.open(record.sessionFile, sessionDir)
        : SessionManager.create(record.cwd, sessionDir);

    const { session } = await createAgentSession({
      cwd: record.cwd,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager,
      settingsManager,
      model: resolveModel(agent, modelRegistry),
    });

    if (agent.tools?.length) {
      session.setActiveToolsByName(agent.tools);
    }

    this.sessions.set(record.workstreamId, session);
    return session;
  }

  async run(input: {
    record: ImplementerWorkstreamRecord;
    agent: AgentConfig;
    task: string;
    signal?: AbortSignal;
  }): Promise<SingleResult> {
    const session = await this.getOrCreateSession(input.record, input.agent);
    const startIndex = session.messages.length;
    const abortSession = () => {
      void session.abort();
    };
    if (input.signal?.aborted) {
      abortSession();
      throw new Error("Implementer was aborted");
    }
    input.signal?.addEventListener("abort", abortSession, { once: true });
    try {
      await session.prompt(`Task: ${input.task}`);
    } finally {
      input.signal?.removeEventListener("abort", abortSession);
    }

    const deltaMessages = session.messages.slice(startIndex).filter((message) => message.role !== "user");
    const { usage, model } = collectUsage(deltaMessages as SingleResult["messages"]);
    const { stopReason, errorMessage, exitCode } = collectTerminalState(deltaMessages as SingleResult["messages"]);

    return {
      agent: input.agent.name,
      agentSource: input.agent.source,
      task: input.task,
      exitCode,
      messages: deltaMessages as SingleResult["messages"],
      stderr: "",
      usage,
      model,
      stopReason,
      errorMessage,
      sessionFile: session.sessionFile,
    };
  }

  dispose(workstreamId: string): void {
    this.sessions.delete(workstreamId);
  }

  disposeAll(): void {
    this.sessions.clear();
  }
}
