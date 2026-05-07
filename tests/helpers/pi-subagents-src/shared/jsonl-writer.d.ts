import type { Readable } from "node:stream";

export function createJsonlWriter(
  jsonlPath: string | undefined,
  stdout: Readable,
): {
  writeLine(line: string): void;
  close(): Promise<void>;
};
