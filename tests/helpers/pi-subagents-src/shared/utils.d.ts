import type { Message } from "@mariozechner/pi-ai";

export function detectSubagentError(messages: Message[] | undefined): {
  hasError: boolean;
  exitCode?: number;
  errorType?: string;
  details?: string;
};

export function extractTextFromContent(content: unknown): string;
export function extractToolArgsPreview(args: Record<string, unknown>): string;
export function findLatestSessionFile(sessionDir: string): string | null;
export function getFinalOutput(messages: Message[] | undefined): string;
