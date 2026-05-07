import type { Message } from "@mariozechner/pi-ai";

export interface MaxOutputConfig {
  bytes?: number;
  lines?: number;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

export interface AgentProgress {
  index: number;
  agent: string;
  status: "pending" | "running" | "completed" | "failed" | "detached";
  task: string;
  skills?: string[];
  currentTool?: string;
  currentToolArgs?: string;
  recentTools: Array<{ tool: string; args: string; endMs: number }>;
  recentOutput: string[];
  toolCount: number;
  tokens: number;
  durationMs: number;
  error?: string;
  failedTool?: string;
}

export interface ArtifactPaths {
  inputPath: string;
  outputPath: string;
  jsonlPath: string;
  metadataPath: string;
}

export interface ArtifactConfig {
  enabled: boolean;
  includeInput: boolean;
  includeOutput: boolean;
  includeJsonl: boolean;
  includeMetadata: boolean;
  cleanupDays: number;
}

export interface SingleResult {
  agent: string;
  task: string;
  exitCode: number;
  messages?: Message[];
  usage: Usage;
  model?: string;
  error?: string;
  sessionFile?: string;
  skills?: string[];
  skillsWarning?: string;
  progress?: AgentProgress;
  progressSummary?: { toolCount: number; tokens: number; durationMs: number };
  artifactPaths?: ArtifactPaths;
  truncation?: {
    text: string;
    truncated: boolean;
    originalBytes?: number;
    originalLines?: number;
    artifactPath?: string;
  };
  finalOutput?: string;
  savedOutputPath?: string;
  outputSaveError?: string;
}

export interface Details {
  mode: "single" | "parallel" | "chain" | "management";
  results: SingleResult[];
  progress?: AgentProgress[];
}

export interface RunSyncOptions {
  cwd?: string;
  signal?: AbortSignal;
  onUpdate?: (r: { content: Array<{ type: "text"; text: string }>; details: Details }) => void;
  maxOutput?: MaxOutputConfig;
  artifactsDir?: string;
  artifactConfig?: Partial<ArtifactConfig>;
  runId: string;
  index?: number;
  sessionDir?: string;
  sessionFile?: string;
  share?: boolean;
  outputPath?: string;
  maxSubagentDepth?: number;
  modelOverride?: string;
  skills?: string[];
}

export const DEFAULT_MAX_OUTPUT: Required<MaxOutputConfig>;

export function getSubagentDepthEnv(maxSubagentDepth: number | undefined): Record<string, string | undefined>;

export function truncateOutput(
  output: string,
  config: Required<MaxOutputConfig>,
  artifactPath?: string,
): { text: string; truncated: boolean; originalBytes?: number; originalLines?: number; artifactPath?: string };
