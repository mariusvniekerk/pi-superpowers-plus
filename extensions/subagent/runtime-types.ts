import type { Message } from "@mariozechner/pi-ai";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface SingleResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  tddViolations?: number;
  step?: number;
  sessionFile?: string;
}

export type ImplementerStatus = "DONE" | "DONE_WITH_CONCERNS" | "BLOCKED" | "NEEDS_CONTEXT";

function isTestCommand(cmd: string): boolean {
  return (
    /\bvitest\b/.test(cmd) ||
    /\bpytest\b/.test(cmd) ||
    /\bnpm\s+test\b/.test(cmd) ||
    /\bpnpm\s+test\b/.test(cmd) ||
    /\byarn\s+test\b/.test(cmd)
  );
}

export function parseImplementerStatus(text: string): ImplementerStatus | undefined {
  const match = text.match(/(?:\*\*)?Status:(?:\*\*)?\s*(DONE_WITH_CONCERNS|DONE|BLOCKED|NEEDS_CONTEXT)\b/i);
  if (!match) return undefined;
  return match[1].toUpperCase() as ImplementerStatus;
}

export function collectSummary(messages: Message[]): {
  filesChanged: string[];
  testsRan: boolean;
  implementerStatus?: ImplementerStatus;
} {
  const files = new Set<string>();
  let testsRan = false;
  let implementerStatus: ImplementerStatus | undefined;

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.content) {
      if (part.type === "text" && !implementerStatus) {
        implementerStatus = parseImplementerStatus(part.text);
        continue;
      }
      if (part.type !== "toolCall") continue;
      if (part.name === "write" || part.name === "edit") {
        // biome-ignore lint/suspicious/noExplicitAny: pi SDK message content type
        const filePath = (part.arguments as any)?.path ?? (part.arguments as any)?.file_path;
        if (typeof filePath === "string") files.add(filePath);
      }
      if (part.name === "bash") {
        // biome-ignore lint/suspicious/noExplicitAny: pi SDK message content type
        const cmd = (part.arguments as any)?.command;
        if (typeof cmd === "string" && isTestCommand(cmd)) testsRan = true;
      }
    }
  }

  return { filesChanged: Array.from(files), testsRan, implementerStatus };
}
