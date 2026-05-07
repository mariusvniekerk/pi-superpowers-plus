export function applyThinkingSuffix(model: string | undefined, thinking: string | undefined): string | undefined;

export function buildPiArgs(input: {
  baseArgs: string[];
  task: string;
  sessionEnabled: boolean;
  sessionDir?: string;
  sessionFile?: string;
  model?: string;
  thinking?: string;
  systemPromptMode?: "append" | "replace";
  inheritProjectContext: boolean;
  inheritSkills: boolean;
  tools?: string[];
  extensions?: string[];
  systemPrompt?: string | null;
  mcpDirectTools?: string[];
  promptFileStem?: string;
}): { args: string[]; env: Record<string, string | undefined>; tempDir?: string };

export function cleanupTempDir(tempDir: string | null | undefined): void;
